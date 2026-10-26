import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, posix } from "node:path";
import type { SkeletonConfig } from "../config/types.ts";
import type { AuditContext } from "./context.ts";
import { createContext } from "./context.ts";
import { resolveWritePath } from "./fix.ts";
import { type FileSource, readRepoText } from "./repo-files.ts";
import { type Issue, issue } from "./report.ts";
import { resolveReviewDependencies, reviewDependencyPatterns } from "./review-deps.ts";
import {
	DOC_META_RE,
	normalizeDocMetaForReview,
	normalizeRelPath,
	stripLegacyReviewDate,
} from "./shared.ts";

/** One proof file per document keeps parallel attestations of different documents conflict-free. */
export const DEFAULT_REVIEW_PROOF_DIR = ".skeleton/reviews";
/** Version 2 kept every document in one shared file; it is read only to migrate it. */
export const LEGACY_REVIEW_LOCKFILE = ".skeleton/review-lock.json";

const PROOF_VERSION = 3;

/**
 * Evidence that someone re-read one document against exact bytes.
 * No date: staleness comes from the git history of the proof file.
 */
export interface ReviewProof {
	version: 3;
	documentHash: string;
	reviewDependencies: Record<string, string>;
}

interface LegacyReviewEntry {
	documentHash: string;
	reviewDependencies: Record<string, string>;
}

export interface AttestDocumentsOptions {
	root: string;
	paths: string[];
	dryRun?: boolean;
}

export interface AttestDocumentsResult {
	documents: string[];
	proofFiles: string[];
	modifiedFiles: string[];
}

export interface MigrateReviewProofResult {
	migrated: string[];
	unverified: string[];
	modifiedFiles: string[];
}

export function reviewProofDir(config: Pick<SkeletonConfig, "reviewProof">): string {
	return normalizeRelPath(config.reviewProof?.dir ?? DEFAULT_REVIEW_PROOF_DIR).replace(/\/$/, "");
}

/** Repo-relative proof file for one document, e.g. `.skeleton/reviews/docs/a.md.json`. */
export function reviewProofPath(
	config: Pick<SkeletonConfig, "reviewProof">,
	document: string,
): string {
	return `${reviewProofDir(config)}/${normalizeRelPath(document)}.json`;
}

function legacyLockPath(config: Pick<SkeletonConfig, "reviewProof">): string {
	return normalizeRelPath(config.reviewProof?.lockfile ?? LEGACY_REVIEW_LOCKFILE);
}

function hash(content: string): string {
	return `sha256:${createHash("sha256").update(content, "utf8").digest("hex")}`;
}

/** Digest of a reviewed document. Doc-meta is metadata, so editing it never invalidates a review. */
export function documentReviewDigest(content: string): string {
	return hash(normalizeDocMetaForReview(content));
}

function isPackageManifest(target: string): boolean {
	return posix.basename(normalizeRelPath(target)) === "package.json";
}

function isMarkdown(target: string): boolean {
	return /\.mdx?$/i.test(target);
}

/**
 * Review evidence for an npm manifest without its release version.
 * Release tooling rewrites the top-level `version` field, which no reviewed claim can depend on.
 * Returns null when the manifest is not a JSON object, so the caller binds the raw bytes.
 */
function manifestWithoutReleaseVersion(content: string): string | null {
	try {
		const parsed: unknown = JSON.parse(content);
		if (!isRecord(parsed)) return null;
		const reviewed = { ...parsed };
		delete reviewed.version;
		return JSON.stringify(reviewed);
	} catch {
		return null;
	}
}

/**
 * Digest that binds a review to one dependency.
 * A `package.json` is compared as parsed JSON without its top-level `version`;
 * a Markdown dependency is compared without its doc-meta comment;
 * every other dependency is compared byte for byte.
 */
export function reviewDependencyDigest(target: string, content: string): string {
	if (isMarkdown(target)) return documentReviewDigest(content);
	if (!isPackageManifest(target)) return hash(content);
	const manifest = manifestWithoutReleaseVersion(content);
	return manifest === null ? hash(content) : hash(manifest);
}

/** True when the current dependency still matches its recorded review digest. */
export function matchesRecordedDependency(input: {
	target: string;
	content: string;
	recorded: string | undefined;
}): boolean {
	const { target, content, recorded } = input;
	if (recorded === undefined) return false;
	return recorded === reviewDependencyDigest(target, content);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSafeRepoPath(value: string): boolean {
	const normalized = normalizeRelPath(value);
	return (
		value.length > 0 &&
		value === normalized &&
		normalized !== "." &&
		normalized !== ".." &&
		!normalized.startsWith("/") &&
		!normalized.startsWith("../") &&
		!normalized.includes("/../") &&
		!/^[A-Za-z]:\//.test(normalized)
	);
}

function isHash(value: unknown): value is string {
	return typeof value === "string" && /^sha256:[a-f0-9]{64}$/.test(value);
}

function parseDependencies(value: unknown): Record<string, string> | null {
	if (!isRecord(value)) return null;
	const out: Record<string, string> = {};
	for (const [target, targetHash] of Object.entries(value)) {
		if (!isSafeRepoPath(target)) return null;
		if (!isHash(targetHash)) return null;
		out[target] = targetHash;
	}
	return out;
}

function parseProof(content: string): ReviewProof | null {
	try {
		const parsed: unknown = JSON.parse(content);
		if (!isRecord(parsed) || parsed.version !== PROOF_VERSION) return null;
		if (!isHash(parsed.documentHash)) return null;
		const reviewDependencies = parseDependencies(parsed.reviewDependencies);
		if (!reviewDependencies) return null;
		return { version: PROOF_VERSION, documentHash: parsed.documentHash, reviewDependencies };
	} catch {
		return null;
	}
}

export type LoadedReviewProof =
	| { status: "missing" }
	| { status: "invalid" }
	| { status: "present"; proof: ReviewProof };

/** Read one document's proof file. */
export function loadReviewProof(input: {
	root: string;
	config: Pick<SkeletonConfig, "reviewProof">;
	document: string;
	source?: FileSource;
}): LoadedReviewProof {
	const content = readRepoText(
		input.root,
		reviewProofPath(input.config, input.document),
		input.source ?? "worktree",
	);
	if (content === null) return { status: "missing" };
	const proof = parseProof(content);
	return proof ? { status: "present", proof } : { status: "invalid" };
}

function formatProof(proof: ReviewProof): string {
	const sorted: ReviewProof = {
		version: PROOF_VERSION,
		documentHash: proof.documentHash,
		reviewDependencies: Object.fromEntries(
			Object.entries(proof.reviewDependencies).sort(([a], [b]) => a.localeCompare(b)),
		),
	};
	return `${JSON.stringify(sorted, null, "\t")}\n`;
}

/**
 * Hash each dependency as it will exist after this run commits.
 * A dependency that this run also rewrites is read from its pending write, not from disk.
 */
function hashDependencies(
	root: string,
	targets: string[],
	pendingWrites: Map<string, string>,
): Record<string, string> {
	const out: Record<string, string> = {};
	for (const target of targets) {
		const pending = pendingWrites.get(target);
		if (pending !== undefined) {
			out[target] = reviewDependencyDigest(target, pending);
			continue;
		}
		const abs = resolveWritePath(root, target);
		if (!existsSync(abs)) throw new Error(`Cannot attest missing review dependency: ${target}`);
		out[target] = reviewDependencyDigest(target, readFileSync(abs, "utf8"));
	}
	return out;
}

function proofFor(root: string, content: string, pendingWrites: Map<string, string>): ReviewProof {
	return {
		version: PROOF_VERSION,
		documentHash: documentReviewDigest(content),
		reviewDependencies: hashDependencies(
			root,
			resolveReviewDependencies(root, reviewDependencyPatterns(content)).targets,
			pendingWrites,
		),
	};
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

/**
 * Read each selected document and drop a legacy `last-reviewed` date.
 * Returns the content each document will have after this run commits.
 */
function documentsWithoutLegacyDates(root: string, selected: string[]): Map<string, string> {
	const documents = new Map<string, string>();
	for (const relPath of selected) {
		const abs = resolveWritePath(root, relPath);
		if (!existsSync(abs)) throw new Error(`Cannot attest missing document: ${relPath}`);
		const original = readFileSync(abs, "utf8");
		if (!DOC_META_RE.test(original)) {
			throw new Error(`Cannot attest ${relPath}: missing doc-meta comment`);
		}
		documents.set(relPath, stripLegacyReviewDate(original) ?? original);
	}
	return documents;
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

/** Record explicit review evidence for exactly the selected documents. */
export function attestDocuments(options: AttestDocumentsOptions): AttestDocumentsResult {
	if (options.paths.length === 0) throw new Error("Review attestation requires explicit paths");
	const ctx = createContext({ root: options.root, paths: options.paths });
	const selected = [...new Set(ctx.docMetaPaths)].sort();
	if (selected.length === 0) throw new Error("No reviewable documents matched --paths");

	const documents = documentsWithoutLegacyDates(ctx.root, selected);
	const writes = changedDocumentWrites(ctx.root, documents);
	const proofFiles: string[] = [];
	// Proofs are built after every document write is known, so a selected document that
	// depends on another selected document binds the bytes this run writes.
	for (const [relPath, content] of documents) {
		const proofPath = reviewProofPath(ctx.config, relPath);
		writes.set(proofPath, formatProof(proofFor(ctx.root, content, documents)));
		proofFiles.push(proofPath);
	}
	if (!options.dryRun) commitWrites(ctx.root, writes);
	return {
		documents: selected,
		proofFiles,
		modifiedFiles: options.dryRun ? [] : [...writes.keys()],
	};
}

function parseLegacyLock(content: string): Record<string, LegacyReviewEntry> | null {
	try {
		const parsed: unknown = JSON.parse(content);
		if (!isRecord(parsed) || parsed.version !== 2 || !isRecord(parsed.documents)) return null;
		const documents: Record<string, LegacyReviewEntry> = {};
		for (const [path, value] of Object.entries(parsed.documents)) {
			if (!(isSafeRepoPath(path) && isRecord(value) && isHash(value.documentHash))) return null;
			const reviewDependencies = parseDependencies(value.reviewDependencies);
			if (!reviewDependencies) return null;
			documents[path] = { documentHash: value.documentHash, reviewDependencies };
		}
		return documents;
	} catch {
		return null;
	}
}

/** Version 2 dependency digest: a manifest without its release version, or raw bytes. */
function legacyDependencyMatches(target: string, content: string, recorded: string): boolean {
	if (recorded === hash(content)) return true;
	if (!isPackageManifest(target)) return false;
	const manifest = manifestWithoutReleaseVersion(content);
	return manifest !== null && recorded === hash(manifest);
}

/** True when a version 2 entry still proves a review of the current bytes. */
function legacyEntryVerifies(root: string, document: string, entry: LegacyReviewEntry): boolean {
	const content = readRepoText(root, document, "worktree");
	if (content === null || hash(content) !== entry.documentHash) return false;
	const targets = resolveReviewDependencies(root, reviewDependencyPatterns(content)).targets;
	if (JSON.stringify(targets) !== JSON.stringify(Object.keys(entry.reviewDependencies).sort())) {
		return false;
	}
	return targets.every((target) => {
		const current = readRepoText(root, target, "worktree");
		const recorded = entry.reviewDependencies[target];
		return (
			current !== null &&
			recorded !== undefined &&
			legacyDependencyMatches(target, current, recorded)
		);
	});
}

function verifiedLegacyDocuments(
	ctx: AuditContext,
	legacy: Record<string, LegacyReviewEntry>,
): string[] {
	const docMetaPaths = new Set(ctx.docMetaPaths);
	return Object.entries(legacy)
		.filter(([document]) => docMetaPaths.has(document))
		.filter(([document, entry]) => legacyEntryVerifies(ctx.root, document, entry))
		.map(([document]) => document)
		.sort();
}

function scannedDocumentsWithoutLegacyDates(ctx: AuditContext): Map<string, string> {
	const documents = new Map<string, string>();
	for (const relPath of ctx.docMetaPaths) {
		const content = readRepoText(ctx.root, relPath, "worktree");
		if (content !== null) documents.set(relPath, stripLegacyReviewDate(content) ?? content);
	}
	return documents;
}

/**
 * Convert a version 2 lock into per-document proof files and drop legacy dates.
 * Only entries that still verify against current bytes carry over; this never attests anything new.
 */
export function migrateReviewProof(options: {
	root: string;
	dryRun?: boolean;
}): MigrateReviewProofResult {
	const ctx = createContext({ root: options.root });
	const lockRel = legacyLockPath(ctx.config);
	const lockContent = readRepoText(ctx.root, lockRel, "worktree");
	const legacy = lockContent === null ? {} : parseLegacyLock(lockContent);
	if (legacy === null) throw new Error(`Review proof lockfile is malformed: ${lockRel}`);

	const verified = verifiedLegacyDocuments(ctx, legacy);
	const unverified = Object.keys(legacy)
		.filter((document) => !verified.includes(document))
		.sort();
	const documents = scannedDocumentsWithoutLegacyDates(ctx);
	const writes = changedDocumentWrites(ctx.root, documents);
	for (const relPath of verified) {
		const content = documents.get(relPath);
		if (content === undefined) continue;
		writes.set(
			reviewProofPath(ctx.config, relPath),
			formatProof(proofFor(ctx.root, content, documents)),
		);
	}
	if (lockContent !== null) writes.set(lockRel, null);
	if (!options.dryRun) commitWrites(ctx.root, writes);
	return {
		migrated: verified,
		unverified,
		modifiedFiles: options.dryRun ? [] : [...writes.keys()],
	};
}

function changedDependencyIssue(relPath: string, target: string): Issue {
	return issue("review-proof", relPath, {
		code: "review-dependency-changed",
		message: `review dependency changed after the recorded review: ${target}`,
		link: target,
		remediation:
			"Re-read the entire document against the current dependencies, then attest it again.",
	});
}

function currentDependencies(input: {
	root: string;
	relPath: string;
	content: string;
	issues: Issue[];
}): string[] | null {
	const { root, relPath, content, issues } = input;
	try {
		return resolveReviewDependencies(root, reviewDependencyPatterns(content)).targets;
	} catch (error) {
		issues.push(
			issue("review-proof", relPath, {
				code: "review-dependency-invalid",
				message: error instanceof Error ? error.message : String(error),
			}),
		);
		return null;
	}
}

function dependencyIssues(input: {
	root: string;
	relPath: string;
	targets: string[];
	proof: ReviewProof;
	source: FileSource;
}): Issue[] {
	const { root, relPath, targets, proof, source } = input;
	const issues: Issue[] = [];
	for (const target of targets) {
		const content = readRepoText(root, target, source);
		if (content === null) {
			issues.push(
				issue("review-proof", relPath, {
					code: "review-dependency-missing",
					message: `recorded review dependency is missing: ${target}`,
					link: target,
				}),
			);
		} else if (
			!matchesRecordedDependency({ target, content, recorded: proof.reviewDependencies[target] })
		) {
			issues.push(changedDependencyIssue(relPath, target));
		}
	}
	return issues;
}

function proofIssues(input: {
	ctx: AuditContext;
	relPath: string;
	content: string;
	proof: ReviewProof;
	source: FileSource;
}): Issue[] {
	const { ctx, relPath, content, proof, source } = input;
	const issues: Issue[] = [];
	if (proof.documentHash !== documentReviewDigest(content)) {
		issues.push(
			issue("review-proof", relPath, {
				code: "review-document-changed",
				message: "document changed after the recorded review",
				remediation: "Re-read the entire document, then attest it again.",
			}),
		);
	}
	const currentTargets = currentDependencies({ root: ctx.root, relPath, content, issues });
	if (!currentTargets) return issues;
	const recordedTargets = Object.keys(proof.reviewDependencies).sort();
	if (JSON.stringify(currentTargets) !== JSON.stringify(recordedTargets)) {
		issues.push(
			issue("review-proof", relPath, {
				code: "review-dependency-set-changed",
				message: "review dependency set changed after the recorded review",
			}),
		);
		return issues;
	}
	issues.push(
		...dependencyIssues({ root: ctx.root, relPath, targets: currentTargets, proof, source }),
	);
	return issues;
}

function legacyLockIssue(lockRel: string): Issue {
	return issue("review-proof", lockRel, {
		code: "review-proof-legacy-lock",
		message: "version 2 review lock found; review proof now lives in one file per document",
		remediation:
			"Run `skeleton audit docs --fix=review-proof` to migrate the proofs that still verify.",
	});
}

export function runReviewProofRule(ctx: AuditContext): Issue[] {
	const source = ctx.fileSource ?? "worktree";
	const lockRel = legacyLockPath(ctx.config);
	if (readRepoText(ctx.root, lockRel, source) !== null) return [legacyLockIssue(lockRel)];

	const issues: Issue[] = [];
	for (const relPath of ctx.docMetaPaths) {
		const content = readRepoText(ctx.root, relPath, source);
		if (content === null) continue;
		const loaded = loadReviewProof({
			root: ctx.root,
			config: ctx.config,
			document: relPath,
			source,
		});
		if (loaded.status === "missing") {
			issues.push(
				issue("review-proof", relPath, {
					code: "review-proof-missing",
					message: "document has no recorded review proof",
					remediation:
						"Review the complete document, then run the explicit review attestation command.",
				}),
			);
		} else if (loaded.status === "invalid") {
			issues.push(
				issue("review-proof", reviewProofPath(ctx.config, relPath), {
					code: "review-proof-invalid",
					message: "review proof file is malformed or uses an unsupported version",
				}),
			);
		} else {
			issues.push(...proofIssues({ ctx, relPath, content, proof: loaded.proof, source }));
		}
	}
	return issues;
}

export const reviewProofRule = { id: "review-proof", run: runReviewProofRule };
