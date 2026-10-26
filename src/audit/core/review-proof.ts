import { existsSync, mkdirSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { globSync } from "tinyglobby";
import type { SkeletonConfig } from "../config/types.ts";
import type { AuditContext } from "./context.ts";
import { createContext } from "./context.ts";
import { resolveWritePath } from "./fix.ts";
import { lastCommitOfLine, readAtCommit } from "./git-meta.ts";
import { type FileSource, readRepoText } from "./repo-files.ts";
import { type Issue, issue } from "./report.ts";
import { resolveReviewDependencies, reviewDependencyPatterns } from "./review-deps.ts";
import {
	combinedDependenciesDigest,
	dependencyDigest,
	fullDocumentDigest,
	shortDigest,
} from "./review-digest.ts";
import {
	formatReviewProofFile,
	parseReviewProofFile,
	type ReviewProofEntry,
	reviewProofEntryLine,
} from "./review-proof-file.ts";
import {
	legacyProofDir,
	legacyReviewVerifies,
	loadLegacyReviewProof,
} from "./review-proof-legacy.ts";
import { DOC_META_RE, normalizeRelPath, stripLegacyReviewDate } from "./shared.ts";

export type { ReviewProofEntry } from "./review-proof-file.ts";

/** The review lock: one TOML entry per reviewed document, so the repository holds one proof file. */
export const DEFAULT_REVIEW_PROOF_FILE = ".skeleton/review-lock.toml";

/**
 * The review lock path. A configured `file` that is not a `.toml` path is a Skeleton 7 line
 * file; it is read only to migrate it, and the lock goes to the default path.
 */
export function reviewProofFile(config: Pick<SkeletonConfig, "reviewProof">): string {
	const configured = config.reviewProof?.file;
	return normalizeRelPath(configured?.endsWith(".toml") ? configured : DEFAULT_REVIEW_PROOF_FILE);
}

/** Short digest of a reviewed document, without its doc-meta comment. */
export function documentReviewDigest(content: string): string {
	return shortDigest(fullDocumentDigest(content));
}

export type LoadedReviewProof =
	| { status: "missing" }
	| { status: "legacy"; files: string[] }
	| { status: "invalid"; line: number }
	| { status: "conflicted"; candidates: ReviewProofEntry[] }
	| { status: "valid"; entries: Map<string, ReviewProofEntry>; content: string };

/** Read the proof file once per run. Legacy proof files block it until they are migrated. */
export function loadReviewProof(input: {
	root: string;
	config: Pick<SkeletonConfig, "reviewProof">;
	source?: FileSource;
}): LoadedReviewProof {
	const source = input.source ?? "worktree";
	const legacy = loadLegacyReviewProof({ root: input.root, config: input.config, source });
	if (legacy.files.length > 0) return { status: "legacy", files: legacy.files };
	const proofPath = reviewProofFile(input.config);
	// An unmerged file has no index entry; the worktree copy then shows the conflict.
	const content =
		readRepoText(input.root, proofPath, source) ??
		(source === "index" ? readRepoText(input.root, proofPath, "worktree") : null);
	if (content === null) return { status: "missing" };
	const parsed = parseReviewProofFile(content);
	if (parsed.status === "valid") return { status: "valid", entries: parsed.entries, content };
	return parsed;
}

/** Per-dependency evidence for a document as it reads now (or as this run will write it). */
function dependencyDigests(input: {
	root: string;
	content: string;
	source: FileSource;
	pending?: Map<string, string>;
}): Record<string, string> {
	const resolved = resolveReviewDependencies(input.root, reviewDependencyPatterns(input.content));
	const out: Record<string, string> = {};
	for (const target of resolved.targets) {
		const text = input.pending?.get(target) ?? readRepoText(input.root, target, input.source);
		if (text === null) throw new Error(`Review dependency is missing: ${target}`);
		out[target] = dependencyDigest(target, text, resolved.selectors[target]);
	}
	return out;
}

function entryFor(input: {
	root: string;
	document: string;
	content: string;
	source: FileSource;
	pending?: Map<string, string>;
}): ReviewProofEntry {
	return {
		document: input.document,
		documentHash: documentReviewDigest(input.content),
		dependenciesHash: combinedDependenciesDigest(dependencyDigests(input)),
	};
}

export type ReviewState =
	| { status: "matches" }
	| { status: "document-changed" }
	| { status: "dependencies-changed" }
	| { status: "dependencies-invalid"; message: string };

/** Compare one document's recorded entry with its current bytes and dependencies. */
export function reviewStateFor(input: {
	root: string;
	entry: ReviewProofEntry;
	content: string;
	source?: FileSource;
}): ReviewState {
	if (input.entry.documentHash !== documentReviewDigest(input.content)) {
		return { status: "document-changed" };
	}
	try {
		const current = combinedDependenciesDigest(
			dependencyDigests({
				root: input.root,
				content: input.content,
				source: input.source ?? "worktree",
			}),
		);
		return current === input.entry.dependenciesHash
			? { status: "matches" }
			: { status: "dependencies-changed" };
	} catch (error) {
		return {
			status: "dependencies-invalid",
			message: error instanceof Error ? error.message : String(error),
		};
	}
}

/** The commit that recorded a document's current entry, from `git blame` of its line. */
function entryCommit(root: string, config: Pick<SkeletonConfig, "reviewProof">, document: string) {
	const proofPath = reviewProofFile(config);
	const content = readRepoText(root, proofPath, "worktree");
	const line = content === null ? null : reviewProofEntryLine(content, document);
	return line === null ? null : lastCommitOfLine(root, proofPath, line);
}

/** UTC day of the commit that recorded a document's review, or null when not committed yet. */
export function reviewCommitDay(
	root: string,
	config: Pick<SkeletonConfig, "reviewProof">,
	document: string,
): string | null {
	return entryCommit(root, config, document)?.day ?? null;
}

/**
 * Name the dependencies that changed since the commit that recorded the review.
 * Empty when git cannot say (no history, uncommitted entry, or only the dependency set changed).
 */
export function changedDependencies(input: {
	root: string;
	config: Pick<SkeletonConfig, "reviewProof">;
	document: string;
	content: string;
	source?: FileSource;
}): string[] {
	const commit = entryCommit(input.root, input.config, input.document);
	if (commit === null) return [];
	const resolved = resolveReviewDependencies(input.root, reviewDependencyPatterns(input.content));
	return resolved.targets.filter((target) => {
		const now = readRepoText(input.root, target, input.source ?? "worktree");
		const then = readAtCommit(input.root, commit.sha, target);
		if (now === null || then === null) return true;
		const selectors = resolved.selectors[target];
		return dependencyDigest(target, now, selectors) !== dependencyDigest(target, then, selectors);
	});
}

/** Apply every write, or none: a failure restores the files already written. A null content deletes. */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: rollback branches preserve all-or-nothing proof writes
function commitWrites(root: string, writes: Map<string, string | null>): void {
	const originals = new Map<string, string | null>();
	const written: string[] = [];
	try {
		for (const [relPath, content] of writes) {
			const abs = resolveWritePath(root, relPath);
			originals.set(relPath, existsSync(abs) ? readFileSync(abs, "utf8") : null);
			if (content === null) {
				if (existsSync(abs)) unlinkSync(abs);
			} else {
				mkdirSync(dirname(abs), { recursive: true });
				writeFileSync(abs, content, "utf8");
			}
			written.push(relPath);
		}
	} catch (error) {
		for (const relPath of written.reverse()) {
			const abs = resolveWritePath(root, relPath);
			const original = originals.get(relPath);
			if (original === null) {
				if (existsSync(abs)) unlinkSync(abs);
			} else if (original !== undefined) {
				mkdirSync(dirname(abs), { recursive: true });
				writeFileSync(abs, original, "utf8");
			}
		}
		throw error;
	}
}

/** Each document's content after this run commits: legacy `last-reviewed` dates removed. */
function documentsWithoutLegacyDates(root: string, documents: string[]): Map<string, string> {
	const out = new Map<string, string>();
	for (const relPath of documents) {
		const content = readRepoText(root, relPath, "worktree");
		if (content !== null) out.set(relPath, stripLegacyReviewDate(content) ?? content);
	}
	return out;
}

function changedDocumentWrites(
	root: string,
	documents: Map<string, string>,
): Map<string, string | null> {
	const writes = new Map<string, string | null>();
	for (const [relPath, content] of documents) {
		if (readFileSync(resolveWritePath(root, relPath), "utf8") !== content) {
			writes.set(relPath, content);
		}
	}
	return writes;
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

/** Entries attestation builds on. Anything other than a clean or absent file must be repaired first. */
function entriesToExtend(
	loaded: LoadedReviewProof,
	proofPath: string,
): Map<string, ReviewProofEntry> {
	if (loaded.status === "valid") return new Map(loaded.entries);
	if (loaded.status === "missing") return new Map();
	if (loaded.status === "legacy") {
		throw new Error(
			`Legacy review proof found (${loaded.files[0]}); run \`skeleton audit docs --fix=review-proof\` first`,
		);
	}
	if (loaded.status === "conflicted") {
		throw new Error(
			`Review proof ${proofPath} has a merge conflict; run \`skeleton audit docs --fix=review-proof\` first`,
		);
	}
	throw new Error(`Review proof ${proofPath} is malformed at line ${loaded.line}`);
}

export interface AttestDocumentsOptions {
	root: string;
	paths: string[];
	dryRun?: boolean;
}

export interface AttestDocumentsResult {
	documents: string[];
	proofFile: string;
	modifiedFiles: string[];
}

/** Record explicit review evidence for exactly the selected documents. Other entries stay byte-identical. */
export function attestDocuments(options: AttestDocumentsOptions): AttestDocumentsResult {
	if (options.paths.length === 0) throw new Error("Review attestation requires explicit paths");
	const ctx = createContext({ root: options.root, paths: options.paths });
	const selected = [...new Set(ctx.docMetaPaths)].sort();
	if (selected.length === 0) throw new Error("No reviewable documents matched --paths");
	assertAttestable(ctx.root, selected);

	const proofPath = reviewProofFile(ctx.config);
	const entries = entriesToExtend(
		loadReviewProof({ root: ctx.root, config: ctx.config }),
		proofPath,
	);
	const documents = documentsWithoutLegacyDates(ctx.root, selected);
	// Entries are built after every document write is known, so a selected document that
	// depends on another selected document binds the bytes this run writes.
	for (const [document, content] of documents) {
		entries.set(
			document,
			entryFor({ root: ctx.root, document, content, source: "worktree", pending: documents }),
		);
	}
	const writes = changedDocumentWrites(ctx.root, documents);
	writes.set(proofPath, formatReviewProofFile(entries.values()));
	if (!options.dryRun) commitWrites(ctx.root, writes);
	return {
		documents: selected,
		proofFile: proofPath,
		modifiedFiles: options.dryRun ? [] : [...writes.keys()],
	};
}

function entryVerifies(
	root: string,
	entry: ReviewProofEntry,
	content: string | undefined,
): boolean {
	return content !== undefined && reviewStateFor({ root, entry, content }).status === "matches";
}

export interface RepairReviewProofResult {
	/** Documents carried over: Skeleton 5/6 proofs that still verify, and Skeleton 7 entries unchanged. */
	migrated: string[];
	/** Legacy reviews that no longer verify; those documents need a normal review. */
	unverified: string[];
	/** Documents whose entry was chosen from a merge conflict because it still verifies. */
	resolved: string[];
	/** Entries moved to a renamed document whose bytes still match. */
	moved: Array<{ from: string; to: string }>;
	/** Entries removed because their document is gone. */
	removed: string[];
	modifiedFiles: string[];
}

/**
 * Resolve a conflicted file. A document with one candidate keeps it, stale or not, so the audit
 * still says what changed. A document with competing candidates keeps the first one that verifies
 * against the merged bytes, or none: then it needs a fresh review.
 */
function conflictWinners(
	root: string,
	candidates: ReviewProofEntry[],
	documents: Map<string, string>,
): { entries: Map<string, ReviewProofEntry>; resolved: string[] } {
	const byDocument = new Map<string, ReviewProofEntry[]>();
	for (const candidate of candidates) {
		byDocument.set(candidate.document, [...(byDocument.get(candidate.document) ?? []), candidate]);
	}
	const entries = new Map<string, ReviewProofEntry>();
	const resolved: string[] = [];
	for (const [document, group] of byDocument) {
		const winner =
			group.length === 1
				? group[0]
				: group.find((candidate) => entryVerifies(root, candidate, documents.get(document)));
		if (!winner) continue;
		entries.set(document, winner);
		if (group.length > 1) resolved.push(document);
	}
	return { entries, resolved: sortedPaths(resolved) };
}

function moveRenamedEntries(input: {
	root: string;
	entries: Map<string, ReviewProofEntry>;
	documents: Map<string, string>;
}): Array<{ from: string; to: string }> {
	const moved: Array<{ from: string; to: string }> = [];
	const unproven = [...input.documents.keys()].filter((document) => !input.entries.has(document));
	for (const [document, entry] of [...input.entries]) {
		if (input.documents.has(document)) continue;
		const target = unproven.find((candidate) =>
			entryVerifies(input.root, { ...entry, document: candidate }, input.documents.get(candidate)),
		);
		if (!target) continue;
		input.entries.delete(document);
		input.entries.set(target, { ...entry, document: target });
		unproven.splice(unproven.indexOf(target), 1);
		moved.push({ from: document, to: target });
	}
	return moved;
}

function removeOrphans(
	entries: Map<string, ReviewProofEntry>,
	documents: Map<string, string>,
): string[] {
	const removed = sortedPaths([...entries.keys()].filter((document) => !documents.has(document)));
	for (const document of removed) entries.delete(document);
	return removed;
}

/** Skeleton 6 kept proof in nested folders; drop them once their files are migrated. */
function removeEmptyLegacyDir(root: string, dir: string): void {
	const abs = resolveWritePath(root, dir);
	if (!existsSync(abs)) return;
	if (globSync("**/*", { cwd: abs, dot: true, onlyFiles: true }).length === 0) {
		rmSync(abs, { recursive: true, force: true });
	}
}

function sortedPaths(paths: Iterable<string>): string[] {
	return [...new Set(paths)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

function legacyVerifies(
	root: string,
	review: Parameters<typeof legacyReviewVerifies>[1],
	documents: Map<string, string>,
): boolean {
	try {
		return documents.has(review.document) && legacyReviewVerifies(root, review);
	} catch {
		return false;
	}
}

/**
 * Skeleton 7 entries use the current digests, so each one carries over unchanged (a stale one
 * stays stale). From a conflicted Skeleton 7 file, the same rules as a conflicted lock apply.
 */
function carryLineEntries(input: {
	root: string;
	legacy: { entries: ReviewProofEntry[]; conflicted: boolean };
	entries: Map<string, ReviewProofEntry>;
	documents: Map<string, string>;
}): string[] {
	const chosen = input.legacy.conflicted
		? conflictWinners(input.root, input.legacy.entries, input.documents).entries
		: new Map(input.legacy.entries.map((entry) => [entry.document, entry]));
	const carried: string[] = [];
	for (const [document, entry] of chosen) {
		if (input.entries.has(document)) continue;
		input.entries.set(document, entry);
		carried.push(document);
	}
	return carried;
}

/** Add an entry for every legacy review that still verifies and has no current entry. */
function migrateLegacyReviews(input: {
	root: string;
	reviews: Parameters<typeof legacyReviewVerifies>[1][];
	entries: Map<string, ReviewProofEntry>;
	documents: Map<string, string>;
}): { migrated: string[]; unverified: string[] } {
	const migrated: string[] = [];
	const unverified: string[] = [];
	for (const review of input.reviews) {
		// A current entry or a deleted document makes the legacy review irrelevant.
		if (input.entries.has(review.document) || !input.documents.has(review.document)) continue;
		if (!legacyVerifies(input.root, review, input.documents)) {
			unverified.push(review.document);
		} else {
			input.entries.set(
				review.document,
				entryFor({
					root: input.root,
					document: review.document,
					content: input.documents.get(review.document) ?? "",
					source: "worktree",
					pending: input.documents,
				}),
			);
			migrated.push(review.document);
		}
	}
	return { migrated: sortedPaths(migrated), unverified: sortedPaths(unverified) };
}

/** The proof file's entries; a conflicted file keeps, per document, the first candidate that verifies. */
function currentEntries(input: {
	root: string;
	proofPath: string;
	documents: Map<string, string>;
}): { content: string | null; entries: Map<string, ReviewProofEntry>; resolved: string[] } {
	const content = readRepoText(input.root, input.proofPath, "worktree");
	const parsed = content === null ? null : parseReviewProofFile(content);
	if (parsed === null) return { content, entries: new Map(), resolved: [] };
	if (parsed.status === "invalid") {
		throw new Error(`Review proof ${input.proofPath} is malformed at line ${parsed.line}`);
	}
	if (parsed.status === "valid") return { content, entries: new Map(parsed.entries), resolved: [] };
	return { content, ...conflictWinners(input.root, parsed.candidates, input.documents) };
}

/**
 * `--fix=review-proof`: migrate Skeleton 5, 6, and 7 proof, resolve a merge conflict, move entries
 * of renamed documents, and drop entries of deleted ones. Only proof that still verifies
 * against current bytes survives; this never attests anything new.
 */
export function repairReviewProof(options: {
	root: string;
	dryRun?: boolean;
}): RepairReviewProofResult {
	const ctx = createContext({ root: options.root });
	const proofPath = reviewProofFile(ctx.config);
	const legacy = loadLegacyReviewProof({ root: ctx.root, config: ctx.config });
	if (legacy.malformed) throw new Error(`Legacy review proof is malformed: ${legacy.malformed}`);
	const documents = documentsWithoutLegacyDates(ctx.root, ctx.docMetaPaths);

	const { content, entries, resolved } = currentEntries({ root: ctx.root, proofPath, documents });
	const carried = carryLineEntries({
		root: ctx.root,
		legacy: legacy.lineEntries,
		entries,
		documents,
	});
	const { migrated: migratedReviews, unverified } = migrateLegacyReviews({
		root: ctx.root,
		reviews: legacy.reviews,
		entries,
		documents,
	});
	const moved = moveRenamedEntries({ root: ctx.root, entries, documents });
	const removed = removeOrphans(entries, documents);
	const writes = changedDocumentWrites(ctx.root, documents);
	if (content !== null || entries.size > 0)
		writes.set(proofPath, formatReviewProofFile(entries.values()));
	for (const file of legacy.files) writes.set(file, null);
	if (!options.dryRun) {
		commitWrites(ctx.root, writes);
		removeEmptyLegacyDir(ctx.root, legacyProofDir(ctx.config));
	}
	return {
		migrated: sortedPaths([...carried, ...migratedReviews]),
		unverified,
		resolved,
		moved,
		removed,
		modifiedFiles: options.dryRun ? [] : [...writes.keys()],
	};
}

const REPAIR = "Run `skeleton audit docs --fix=review-proof`.";
const REREAD =
	"Re-read the entire document against its current dependencies, then attest it again.";

function documentIssues(input: {
	ctx: AuditContext;
	document: string;
	content: string;
	entry: ReviewProofEntry;
	source: FileSource;
}): Issue[] {
	const { ctx, document, content, entry, source } = input;
	const state = reviewStateFor({ root: ctx.root, entry, content, source });
	if (state.status === "matches") return [];
	if (state.status === "document-changed") {
		return [
			issue("review-proof", document, {
				code: "review-document-changed",
				message: "document changed after the recorded review",
				remediation: REREAD,
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
	const changed = changedDependencies({
		root: ctx.root,
		config: ctx.config,
		document,
		content,
		source,
	});
	if (changed.length === 0) {
		return [
			issue("review-proof", document, {
				code: "review-dependency-changed",
				message: "review dependencies changed after the recorded review",
				remediation: REREAD,
			}),
		];
	}
	return changed.map((target) =>
		issue("review-proof", document, {
			code: "review-dependency-changed",
			message: `review dependency changed after the recorded review: ${target}`,
			link: target,
			remediation: REREAD,
		}),
	);
}

function fileIssue(proofPath: string, loaded: LoadedReviewProof): Issue | null {
	if (loaded.status === "legacy") {
		return issue("review-proof", loaded.files[0] ?? proofPath, {
			code: "review-proof-legacy",
			message: "Skeleton 5, 6, or 7 review proof found; review proof now lives in the review lock",
			remediation: `${REPAIR} It moves the old proof into ${proofPath}; Skeleton 5/6 proofs carry over only while they still verify.`,
		});
	}
	if (loaded.status === "invalid") {
		return issue("review-proof", proofPath, {
			code: "review-proof-invalid",
			message: `review proof file is malformed at line ${loaded.line}`,
		});
	}
	if (loaded.status === "conflicted") {
		return issue("review-proof", proofPath, {
			code: "review-proof-conflict",
			message: "review proof file has a merge conflict",
			remediation: `${REPAIR} It keeps the entries that still verify and attests nothing new.`,
		});
	}
	return null;
}

function orphanIssues(
	ctx: AuditContext,
	entries: Map<string, ReviewProofEntry>,
	source: FileSource,
): Issue[] {
	if (ctx.pathScoped) return [];
	const documents = new Set(ctx.docMetaPaths);
	return [...entries.keys()]
		.filter((document) => !documents.has(document))
		.filter((document) => {
			const content = readRepoText(ctx.root, document, source);
			return content === null || !DOC_META_RE.test(content);
		})
		.map((document) =>
			issue("review-proof", reviewProofFile(ctx.config), {
				code: "review-proof-orphan",
				message: `review proof entry has no document: ${document}`,
				severity: "warning",
				remediation: `${REPAIR} It moves the entry of a renamed document or removes it.`,
			}),
		);
}

export function runReviewProofRule(ctx: AuditContext): Issue[] {
	const source = ctx.fileSource ?? "worktree";
	const proofPath = reviewProofFile(ctx.config);
	const loaded = loadReviewProof({ root: ctx.root, config: ctx.config, source });
	const blocking = fileIssue(proofPath, loaded);
	if (blocking) return [blocking];
	const entries = loaded.status === "valid" ? loaded.entries : new Map<string, ReviewProofEntry>();

	const issues: Issue[] = [];
	for (const document of ctx.docMetaPaths) {
		const content = readRepoText(ctx.root, document, source);
		if (content === null) continue;
		const entry = entries.get(normalizeRelPath(document));
		if (!entry) {
			issues.push(
				issue("review-proof", document, {
					code: "review-proof-missing",
					message: "document has no recorded review proof",
					remediation:
						"Review the complete document, then run the explicit review attestation command.",
				}),
			);
			continue;
		}
		issues.push(...documentIssues({ ctx, document, content, entry, source }));
	}
	issues.push(...orphanIssues(ctx, entries, source));
	return issues;
}

export const reviewProofRule = { id: "review-proof", run: runReviewProofRule };
