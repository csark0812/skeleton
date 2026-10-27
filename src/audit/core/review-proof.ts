import { unlinkSync } from "node:fs";
import type { SkeletonConfig } from "../config/types.ts";
import type { AuditContext } from "./context.ts";
import { createContext } from "./context.ts";
import { resolveWritePath } from "./fix.ts";
import { lastCommitOfLine, readAtCommit } from "./git-meta.ts";
import { type FileSource, pathDiffersFromHead, readRepoText } from "./repo-files.ts";
import { type Issue, issue } from "./report.ts";
import { resolveReviewDependencies, reviewDependencyPatterns } from "./review-deps.ts";
import {
	combinedDependenciesDigest,
	dependencyDigest,
	fullDocumentDigest,
	shortDigest,
} from "./review-digest.ts";
import {
	type Attestation,
	type AttestationLine,
	commitOnHead,
	formatAttestationLines,
	git,
	headCommit,
	landedReviewOf,
	type ReviewHistory,
	readReviewHistory,
} from "./review-history.ts";
import {
	parseReviewProofFile,
	type ReviewProofEntry,
	reviewProofEntryLine,
} from "./review-proof-file.ts";
import { DOC_META_RE, normalizeRelPath } from "./shared.ts";

export type { Attestation, ReviewHistory } from "./review-history.ts";

/** Skeleton 8 kept review proof in this tracked file; it is read only to migrate it. */
export const DEFAULT_REVIEW_PROOF_FILE = ".skeleton/review-lock.toml";

/** The Skeleton 8 review lock path, read only by `skeleton attest --migrate`. */
export function reviewProofFile(config: Pick<SkeletonConfig, "reviewProof">): string {
	const configured = config.reviewProof?.file;
	return normalizeRelPath(configured?.endsWith(".toml") ? configured : DEFAULT_REVIEW_PROOF_FILE);
}

/** Short digest of a reviewed document, without its doc-meta comment. */
export function documentReviewDigest(content: string): string {
	return shortDigest(fullDocumentDigest(content));
}

/** One git log pass per HEAD: every rule and document in a run reads the same history. */
const historyCache = new Map<string, ReviewHistory>();

export function loadReviewHistory(root: string): ReviewHistory {
	const key = `${root}\0${headCommit(root) ?? ""}`;
	const cached = historyCache.get(key);
	if (cached) return cached;
	const history = readReviewHistory(root);
	historyCache.set(key, history);
	return history;
}

/** Per-dependency evidence for a document as it reads now. */
function dependencyDigests(input: {
	root: string;
	content: string;
	source: FileSource;
}): Record<string, string> {
	const resolved = resolveReviewDependencies(input.root, reviewDependencyPatterns(input.content));
	const out: Record<string, string> = {};
	for (const target of resolved.targets) {
		const text = readRepoText(input.root, target, input.source);
		if (text === null) throw new Error(`Review dependency is missing: ${target}`);
		out[target] = dependencyDigest(target, text, resolved.selectors[target]);
	}
	return out;
}

/** The digests a review of this document records, as it reads now. */
function currentDigests(input: {
	root: string;
	document: string;
	content: string;
	source: FileSource;
}): AttestationLine {
	return {
		document: input.document,
		documentHash: documentReviewDigest(input.content),
		dependenciesHash: combinedDependenciesDigest(dependencyDigests(input)),
	};
}

export type ReviewState =
	| { status: "matches"; attestation: Attestation }
	| { status: "missing" }
	/** The bytes combine reviewed edits from merged branches; no one attested the combination. */
	| { status: "merged-unattested"; attestation: Attestation }
	| { status: "document-changed"; attestation: Attestation }
	| { status: "dependencies-changed"; attestation: Attestation }
	| { status: "dependencies-invalid"; message: string };

function documentAndDependencyPaths(root: string, document: string, content: string): string[] {
	const targets = resolveReviewDependencies(root, reviewDependencyPatterns(content)).targets;
	return [document, ...targets];
}

/** True when the document and its dependencies read exactly as committed at HEAD. */
function readsAsHead(root: string, paths: string[], source: FileSource): boolean {
	return paths.every((path) => {
		const head = git(root, ["show", `HEAD:./${path}`]);
		const current = readRepoText(root, path, source);
		return head.status === 0 && current === head.stdout;
	});
}

/**
 * Compare a document as it reads now with every review of it reachable from HEAD.
 * It matches when any review recorded exactly these document and dependency digests.
 */
export function reviewStateFor(input: {
	root: string;
	history: Map<string, Attestation[]>;
	document: string;
	content: string;
	source?: FileSource;
}): ReviewState {
	const source = input.source ?? "worktree";
	const reviews = input.history.get(normalizeRelPath(input.document)) ?? [];
	let current: AttestationLine;
	try {
		current = currentDigests({ ...input, source });
	} catch (error) {
		return {
			status: "dependencies-invalid",
			message: error instanceof Error ? error.message : String(error),
		};
	}
	const match = reviews.find(
		(review) =>
			review.documentHash === current.documentHash &&
			review.dependenciesHash === current.dependenciesHash,
	);
	if (match) return { status: "matches", attestation: match };
	const latest = reviews[0];
	if (!latest) return { status: "missing" };
	const paths = documentAndDependencyPaths(input.root, input.document, input.content);
	const landed =
		readsAsHead(input.root, paths, source) &&
		landedReviewOf({ root: input.root, document: input.document, paths, history: input.history });
	if (landed) return { status: "merged-unattested", attestation: latest };
	return latest.documentHash === current.documentHash
		? { status: "dependencies-changed", attestation: latest }
		: { status: "document-changed", attestation: latest };
}

/** UTC day of the review that covers a document as it reads now, or null when none does. */
export function reviewCommitDay(root: string, document: string): string | null {
	const history = loadReviewHistory(root);
	if (history.status !== "available") return null;
	const content = readRepoText(root, document, "worktree");
	if (content === null) return null;
	const state = reviewStateFor({ root, history: history.byDocument, document, content });
	return state.status === "matches" ? state.attestation.day : null;
}

/**
 * Name the dependencies that changed since a review.
 * Empty when git cannot say (the commit is unavailable, or only the dependency set changed).
 */
export function changedDependencies(input: {
	root: string;
	attestation: Attestation;
	content: string;
	source?: FileSource;
}): string[] {
	const resolved = resolveReviewDependencies(input.root, reviewDependencyPatterns(input.content));
	return resolved.targets.filter((target) => {
		const now = readRepoText(input.root, target, input.source ?? "worktree");
		const then = readAtCommit(input.root, input.attestation.sha, target);
		if (now === null || then === null) return true;
		const selectors = resolved.selectors[target];
		return dependencyDigest(target, now, selectors) !== dependencyDigest(target, then, selectors);
	});
}

function assertAttestable(root: string, selected: string[]): void {
	for (const relPath of selected) {
		const content = readRepoText(root, relPath, "worktree");
		if (content === null) throw new Error(`Cannot attest missing document: ${relPath}`);
		if (!DOC_META_RE.test(content)) {
			throw new Error(`Cannot attest ${relPath}: missing doc-meta comment`);
		}
	}
}

/** A review binds committed bytes: the document and every dependency must read as HEAD. */
function assertCommitted(root: string, selected: string[]): void {
	const dirty = new Set<string>();
	for (const document of selected) {
		const content = readRepoText(root, document, "worktree") ?? "";
		for (const path of documentAndDependencyPaths(root, document, content)) {
			if (pathDiffersFromHead(root, path)) dirty.add(path);
		}
	}
	if (dirty.size === 0) return;
	throw new Error(
		`Commit these first, then attest: ${[...dirty].sort().join(", ")}. A review records committed bytes.`,
	);
}

export interface AttestDocumentsOptions {
	root: string;
	paths: string[];
	dryRun?: boolean;
	/**
	 * What the reviewer checked. Required to re-attest a document whose text did not change
	 * since its last review, so a dependency change is not answered with a bare stamp.
	 */
	reason?: string;
}

export interface AttestDocumentsResult {
	documents: string[];
	/** The attest commit, or null on a dry run. */
	commit: string | null;
	message: string;
}

/** A re-attest that leaves the text unchanged must say what was checked against the changed code. */
function assertReasonForUnchangedText(
	history: Map<string, Attestation[]>,
	next: AttestationLine[],
	reason: string | undefined,
): void {
	if (reason !== undefined) return;
	const unchanged = next
		.filter((line) => {
			const before = history.get(line.document)?.[0];
			return (
				before !== undefined &&
				before.documentHash === line.documentHash &&
				before.dependenciesHash !== line.dependenciesHash
			);
		})
		.map((line) => line.document);
	if (unchanged.length === 0) return;
	throw new Error(
		`Text unchanged since the last review of ${unchanged.join(", ")}; its dependencies changed. ` +
			'After checking the claims against them, say what you checked: --reason "…".',
	);
}

function requireHistory(root: string): Map<string, Attestation[]> {
	const history = loadReviewHistory(root);
	if (history.status === "unavailable")
		throw new Error(`Review history unavailable: ${history.reason}`);
	return history.byDocument;
}

function attestSubject(documents: string[]): string {
	return documents.length === 1
		? `docs: attest ${documents[0]}`
		: `docs: attest ${documents.length} documents`;
}

/**
 * Record explicit review evidence for exactly the selected documents: one empty commit on
 * HEAD whose message carries a review line per document. Nothing tracked changes.
 */
export function attestDocuments(options: AttestDocumentsOptions): AttestDocumentsResult {
	if (options.paths.length === 0) throw new Error("Review attestation requires explicit paths");
	const ctx = createContext({ root: options.root, paths: options.paths });
	const selected = [...new Set(ctx.docMetaPaths)].sort();
	if (selected.length === 0) throw new Error("No reviewable documents matched --paths");
	assertAttestable(ctx.root, selected);
	if (headCommit(ctx.root) === null) {
		throw new Error("Cannot attest before the first commit; commit the documents first");
	}
	assertCommitted(ctx.root, selected);
	const history = requireHistory(ctx.root);
	const reason = options.reason?.trim() || undefined;
	const lines = selected.map((document) => {
		const digests = currentDigests({
			root: ctx.root,
			document,
			content: readRepoText(ctx.root, document, "worktree") ?? "",
			source: "worktree",
		});
		return reason === undefined ? digests : { ...digests, note: reason };
	});
	assertReasonForUnchangedText(history, lines, reason);
	const message = `${attestSubject(selected)}\n\n${formatAttestationLines(lines).join("\n")}\n`;
	const commit = options.dryRun ? null : commitOnHead(ctx.root, message);
	return { documents: selected, commit, message };
}

export interface MigrateReviewLockResult {
	/** Documents whose Skeleton 8 entry still verified; their review carries over with its date. */
	migrated: string[];
	/** Entries that no longer verify, or whose document is gone; those documents need a review. */
	unverified: string[];
	/** The migration commit, or null on a dry run or when there is no lock. */
	commit: string | null;
}

function sortedPaths(paths: string[]): string[] {
	return [...paths].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

/** The lock's entries, or why the lock cannot be migrated as it stands. */
function lockEntries(root: string, lockPath: string, content: string): ReviewProofEntry[] {
	if (headCommit(root) === null || pathDiffersFromHead(root, lockPath)) {
		throw new Error(`Commit ${lockPath} first, then migrate it`);
	}
	const parsed = parseReviewProofFile(content);
	if (parsed.status === "conflicted") {
		throw new Error(
			`${lockPath} has a merge conflict; resolve it with Skeleton 8 \`attest --repair\` first`,
		);
	}
	if (parsed.status === "invalid") {
		throw new Error(`${lockPath} is malformed at line ${parsed.line}`);
	}
	return [...parsed.entries.values()];
}

/** True when the entry still records the document and its dependencies as they read now. */
function entryVerifies(root: string, entry: ReviewProofEntry, documents: Set<string>): boolean {
	const content = documents.has(entry.document)
		? readRepoText(root, entry.document, "worktree")
		: null;
	if (content === null) return false;
	try {
		const current = currentDigests({ root, document: entry.document, content, source: "worktree" });
		return (
			current.documentHash === entry.documentHash &&
			current.dependenciesHash === entry.dependenciesHash
		);
	} catch {
		return false;
	}
}

/** One commit that deletes the lock and carries the reviews; hooks would check the lock it removes. */
function commitLockRemoval(root: string, lockPath: string, message: string): string | null {
	unlinkSync(resolveWritePath(root, lockPath));
	const removed = git(root, ["rm", "-q", "--cached", "--", lockPath]);
	if (removed.status !== 0) throw new Error(`git rm failed: ${removed.stderr.trim()}`);
	const made = git(
		root,
		["commit", "-q", "--no-verify", "--only", "-F", "-", "--", lockPath],
		message,
	);
	if (made.status !== 0) throw new Error(`git commit failed: ${made.stderr.trim()}`);
	return headCommit(root);
}

/**
 * `skeleton attest --migrate`: move a Skeleton 8 review lock into history. One commit deletes
 * the lock and carries a review line for every entry that still verifies, dated by the commit
 * that recorded it. Nothing new is attested.
 */
export function migrateReviewLock(options: {
	root: string;
	dryRun?: boolean;
}): MigrateReviewLockResult {
	const ctx = createContext({ root: options.root });
	const lockPath = reviewProofFile(ctx.config);
	const content = readRepoText(ctx.root, lockPath, "worktree");
	if (content === null) return { migrated: [], unverified: [], commit: null };
	const documents = new Set(ctx.docMetaPaths.map(normalizeRelPath));
	const migrated: AttestationLine[] = [];
	const unverified: string[] = [];
	for (const entry of lockEntries(ctx.root, lockPath, content)) {
		if (!entryVerifies(ctx.root, entry, documents)) {
			unverified.push(entry.document);
			continue;
		}
		const line = reviewProofEntryLine(content, entry.document);
		const since = line === null ? undefined : lastCommitOfLine(ctx.root, lockPath, line)?.day;
		migrated.push({ ...entry, ...(since ? { since } : {}) });
	}
	const message = `docs: move review proof into commit history\n\nSkeleton 9 keeps review proof in commit messages; ${lockPath} is no longer used.\n\n${formatAttestationLines(migrated).join("\n")}\n`;
	return {
		migrated: sortedPaths(migrated.map((line) => line.document)),
		unverified: sortedPaths(unverified),
		commit: options.dryRun ? null : commitLockRemoval(ctx.root, lockPath, message),
	};
}

function rereadRemediation(document: string): string {
	return `Re-read the entire document against its current dependencies, commit any edit, then run \`skeleton attest ${document}\` (add --reason "…" if the text did not need to change).`;
}

function issuesForState(input: {
	ctx: AuditContext;
	document: string;
	content: string;
	state: ReviewState;
	source: FileSource;
}): Issue[] {
	const { ctx, document, content, state, source } = input;
	if (state.status === "matches") return [];
	if (state.status === "missing") {
		return [
			issue("review-proof", document, {
				code: "review-proof-missing",
				message: "document has no recorded review",
				remediation: `Review the complete document, then run \`skeleton attest ${document}\`.`,
			}),
		];
	}
	if (state.status === "dependencies-invalid") {
		return [
			issue("review-proof", document, {
				code: "review-dependency-invalid",
				message: state.message,
			}),
		];
	}
	if (state.status === "merged-unattested") {
		return [
			issue("review-proof", document, {
				code: "review-merged-unattested",
				message:
					"merged branches each reviewed this document, but no one has reviewed the combined text",
				// A combination that merged cleanly does not block unrelated work; whoever
				// touches the document next re-reads the combined text.
				severity: ctx.pathScoped ? "error" : "warning",
				remediation: rereadRemediation(document),
			}),
		];
	}
	if (state.status === "document-changed") {
		return [
			issue("review-proof", document, {
				code: "review-document-changed",
				message: "document changed after its last recorded review",
				remediation: rereadRemediation(document),
			}),
		];
	}
	return dependencyIssues({ ctx, document, content, attestation: state.attestation, source });
}

function dependencyIssues(input: {
	ctx: AuditContext;
	document: string;
	content: string;
	attestation: Attestation;
	source: FileSource;
}): Issue[] {
	const { ctx, document } = input;
	const changed = changedDependencies({
		root: ctx.root,
		attestation: input.attestation,
		content: input.content,
		source: input.source,
	});
	if (changed.length === 0) {
		return [
			issue("review-proof", document, {
				code: "review-dependency-changed",
				message: "review dependencies changed after the last recorded review",
				remediation: rereadRemediation(document),
			}),
		];
	}
	return changed.map((target) =>
		issue("review-proof", document, {
			code: "review-dependency-changed",
			message: `review dependency changed after the last recorded review: ${target}`,
			link: target,
			remediation: rereadRemediation(document),
		}),
	);
}

function lockIssue(ctx: AuditContext): Issue | null {
	if (ctx.pathScoped) return null;
	const lockPath = reviewProofFile(ctx.config);
	if (readRepoText(ctx.root, lockPath, ctx.fileSource ?? "worktree") === null) return null;
	return issue("review-proof", lockPath, {
		code: "review-lock-retired",
		message: "Skeleton 9 keeps review proof in commit history; this review lock is no longer read",
		remediation:
			"Run `skeleton attest --migrate` once. It carries every review that still verifies.",
	});
}

export function runReviewProofRule(ctx: AuditContext): Issue[] {
	const source = ctx.fileSource ?? "worktree";
	const history = loadReviewHistory(ctx.root);
	if (history.status === "unavailable") {
		return [
			issue("review-proof", ".", {
				code: "review-history-unavailable",
				message: `review proof cannot be checked: ${history.reason}`,
			}),
		];
	}
	const issues: Issue[] = [];
	const retired = lockIssue(ctx);
	if (retired) issues.push(retired);
	for (const document of ctx.docMetaPaths) {
		const content = readRepoText(ctx.root, document, source);
		if (content === null) continue;
		const state = reviewStateFor({
			root: ctx.root,
			history: history.byDocument,
			document: normalizeRelPath(document),
			content,
			source,
		});
		issues.push(...issuesForState({ ctx, document, content, state, source }));
	}
	return issues;
}

export const reviewProofRule = { id: "review-proof", run: runReviewProofRule };
