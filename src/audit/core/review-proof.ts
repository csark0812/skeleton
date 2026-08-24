import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, relative } from "node:path";
import type { AuditContext } from "./context.ts";
import { createContext } from "./context.ts";
import { resolveWritePath } from "./fix.ts";
import { type Issue, issue } from "./report.ts";
import { resolveReviewDependencies, reviewDependencyPatterns } from "./review-deps.ts";
import {
	DOC_META_RE,
	docMetaLastReviewed,
	normalizeRelPath,
	replaceDocMetaLastReviewed,
} from "./shared.ts";

export const DEFAULT_REVIEW_LOCKFILE = ".skeleton/review-lock.json";

interface ReviewProofEntry {
	reviewedAt: string;
	documentHash: string;
	reviewDependencies: Record<string, string>;
}

interface ReviewProofLock {
	version: 2;
	documents: Record<string, ReviewProofEntry>;
}

export interface AttestDocumentsOptions {
	root: string;
	paths: string[];
	reviewedAt?: string;
	dryRun?: boolean;
}

export interface AttestDocumentsResult {
	reviewedAt: string;
	documents: string[];
	lockfile: string | null;
	modifiedFiles: string[];
}

export function formatLocalReviewDate(date: Date): string {
	const year = date.getFullYear();
	const month = String(date.getMonth() + 1).padStart(2, "0");
	const day = String(date.getDate()).padStart(2, "0");
	return `${year}-${month}-${day}`;
}

function hash(content: string): string {
	return `sha256:${createHash("sha256").update(content, "utf8").digest("hex")}`;
}

function emptyLock(): ReviewProofLock {
	return { version: 2, documents: {} };
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isCalendarDate(value: unknown): value is string {
	if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
	const parsed = new Date(`${value}T00:00:00.000Z`);
	return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
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

function parseEntry(value: unknown): ReviewProofEntry | null {
	if (!isRecord(value)) return null;
	if (!isCalendarDate(value.reviewedAt)) return null;
	if (!isHash(value.documentHash)) return null;
	if (!isRecord(value.reviewDependencies)) return null;
	const reviewDependencies: Record<string, string> = {};
	for (const [target, targetHash] of Object.entries(value.reviewDependencies)) {
		if (!isSafeRepoPath(target)) return null;
		if (!isHash(targetHash)) return null;
		reviewDependencies[target] = targetHash;
	}
	return { reviewedAt: value.reviewedAt, documentHash: value.documentHash, reviewDependencies };
}

function lockPath(ctx: Pick<AuditContext, "config">): string {
	return normalizeRelPath(ctx.config.reviewProof?.lockfile ?? DEFAULT_REVIEW_LOCKFILE);
}

function parseLock(content: string): ReviewProofLock | null {
	try {
		const parsed: unknown = JSON.parse(content);
		if (!isRecord(parsed) || parsed.version !== 2 || !isRecord(parsed.documents)) return null;
		const documents: Record<string, ReviewProofEntry> = {};
		for (const [path, value] of Object.entries(parsed.documents)) {
			const entry = parseEntry(value);
			if (!isSafeRepoPath(path)) return null;
			if (!entry) return null;
			documents[path] = entry;
		}
		return { version: 2, documents };
	} catch {
		return null;
	}
}

function loadLock(root: string, relPath: string): ReviewProofLock | null {
	const abs = resolveWritePath(root, relPath);
	if (!existsSync(abs)) return null;
	return parseLock(readFileSync(abs, "utf8"));
}

function hashDependencies(root: string, targets: string[]): Record<string, string> {
	const out: Record<string, string> = {};
	for (const target of targets) {
		const abs = resolveWritePath(root, target);
		if (!existsSync(abs)) throw new Error(`Cannot attest missing review dependency: ${target}`);
		out[target] = hash(readFileSync(abs, "utf8"));
	}
	return out;
}

function sortedLock(lock: ReviewProofLock): ReviewProofLock {
	const documents: Record<string, ReviewProofEntry> = {};
	for (const path of Object.keys(lock.documents).sort()) {
		const entry = lock.documents[path];
		if (!entry) continue;
		documents[path] = {
			reviewedAt: entry.reviewedAt,
			documentHash: entry.documentHash,
			reviewDependencies: Object.fromEntries(
				Object.entries(entry.reviewDependencies).sort(([a], [b]) => a.localeCompare(b)),
			),
		};
	}
	return { version: 2, documents };
}

function validateReviewedAt(reviewedAt: string): void {
	if (!isCalendarDate(reviewedAt)) {
		throw new Error(`Invalid review date: ${reviewedAt}. Use YYYY-MM-DD.`);
	}
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: rollback branches preserve all-or-nothing attestation writes
function commitWrites(root: string, writes: Map<string, string>): void {
	const originals = new Map<string, string | null>();
	const written: string[] = [];
	try {
		for (const [relPath, content] of writes) {
			const abs = resolveWritePath(root, relPath);
			originals.set(relPath, existsSync(abs) ? readFileSync(abs, "utf8") : null);
			mkdirSync(dirname(abs), { recursive: true });
			writeFileSync(abs, content, "utf8");
			written.push(relPath);
		}
	} catch (error) {
		for (const relPath of written.reverse()) {
			const abs = resolveWritePath(root, relPath);
			const original = originals.get(relPath);
			if (original === null) unlinkSync(abs);
			else if (original !== undefined) writeFileSync(abs, original, "utf8");
		}
		throw error;
	}
}

/** Record explicit review evidence for exactly the selected documents. */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: ordered fail-closed stages keep attestation writes auditable
export function attestDocuments(options: AttestDocumentsOptions): AttestDocumentsResult {
	if (options.paths.length === 0) throw new Error("Review attestation requires explicit paths");
	const reviewedAt = options.reviewedAt ?? formatLocalReviewDate(new Date());
	validateReviewedAt(reviewedAt);
	const ctx = createContext({ root: options.root, paths: options.paths });
	const selected = [...new Set(ctx.docMetaPaths)].sort();
	if (selected.length === 0) throw new Error("No reviewable documents matched --paths");

	const proofPath = ctx.config.reviewProof ? lockPath(ctx) : null;
	let lock: ReviewProofLock | null = null;
	if (proofPath) {
		const absProof = resolveWritePath(ctx.root, proofPath);
		lock = loadLock(ctx.root, proofPath);
		if (existsSync(absProof) && !lock) {
			throw new Error(`Review proof lockfile is malformed: ${proofPath}`);
		}
		lock ??= emptyLock();
	}
	const writes = new Map<string, string>();

	for (const relPath of selected) {
		const abs = resolveWritePath(ctx.root, relPath);
		if (!existsSync(abs)) throw new Error(`Cannot attest missing document: ${relPath}`);
		const original = readFileSync(abs, "utf8");
		if (!DOC_META_RE.test(original)) {
			throw new Error(`Cannot attest ${relPath}: missing doc-meta comment`);
		}
		const updated = replaceDocMetaLastReviewed(original, reviewedAt) ?? original;
		writes.set(relPath, updated);
		if (lock) {
			lock.documents[relPath] = {
				reviewedAt,
				documentHash: hash(updated),
				reviewDependencies: hashDependencies(
					ctx.root,
					resolveReviewDependencies(ctx.root, reviewDependencyPatterns(updated)).targets,
				),
			};
		}
	}

	if (lock && proofPath) {
		writes.set(proofPath, `${JSON.stringify(sortedLock(lock), null, "\t")}\n`);
	}
	if (!options.dryRun) {
		commitWrites(ctx.root, writes);
	}

	return {
		reviewedAt,
		documents: selected,
		lockfile: proofPath,
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

function validateEntry(input: {
	ctx: AuditContext;
	relPath: string;
	content: string;
	entry: ReviewProofEntry;
}): Issue[] {
	const { ctx, relPath, content, entry } = input;
	const issues = documentProofIssues(relPath, content, entry);
	const currentTargets = currentDependencies({ root: ctx.root, relPath, content, issues });
	if (!currentTargets) return issues;
	const recordedTargets = Object.keys(entry.reviewDependencies).sort();
	if (JSON.stringify(currentTargets) !== JSON.stringify(recordedTargets)) {
		issues.push(
			issue("review-proof", relPath, {
				code: "review-dependency-set-changed",
				message: "review dependency set changed after the recorded review",
			}),
		);
		return issues;
	}
	issues.push(...dependencyHashIssues({ root: ctx.root, relPath, targets: currentTargets, entry }));
	return issues;
}

function documentProofIssues(relPath: string, content: string, entry: ReviewProofEntry): Issue[] {
	const issues: Issue[] = [];
	if (entry.reviewedAt !== docMetaLastReviewed(content)) {
		issues.push(
			issue("review-proof", relPath, {
				code: "review-date-mismatch",
				message: `doc-meta date does not match recorded review ${entry.reviewedAt}`,
			}),
		);
	}
	if (entry.documentHash !== hash(content)) {
		issues.push(
			issue("review-proof", relPath, {
				code: "review-document-changed",
				message: "document bytes changed after the recorded review",
				remediation: "Re-read the entire document, then attest it again.",
			}),
		);
	}
	return issues;
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

function dependencyHashIssues(input: {
	root: string;
	relPath: string;
	targets: string[];
	entry: ReviewProofEntry;
}): Issue[] {
	const { root, relPath, targets, entry } = input;
	const issues: Issue[] = [];
	for (const target of targets) {
		const abs = resolveWritePath(root, target);
		if (!existsSync(abs)) {
			issues.push(
				issue("review-proof", relPath, {
					code: "review-dependency-missing",
					message: `recorded review dependency is missing: ${target}`,
					link: target,
				}),
			);
		} else if (entry.reviewDependencies[target] !== hash(readFileSync(abs, "utf8"))) {
			issues.push(changedDependencyIssue(relPath, target));
		}
	}
	return issues;
}

export function runReviewProofRule(ctx: AuditContext): Issue[] {
	if (!ctx.config.reviewProof) return [];
	const relLock = lockPath(ctx);
	const absLock = resolveWritePath(ctx.root, relLock);
	if (!existsSync(absLock)) {
		return [
			issue("review-proof", relLock, {
				code: "review-proof-lock-missing",
				message: "review proof is enabled but its lockfile is missing",
			}),
		];
	}
	const lock = parseLock(readFileSync(absLock, "utf8"));
	if (!lock) {
		return [
			issue("review-proof", relLock, {
				code: "review-proof-lock-invalid",
				message: "review proof lockfile is malformed or uses an unsupported version",
			}),
		];
	}

	const issues: Issue[] = [];
	for (const relPath of ctx.docMetaPaths) {
		const abs = resolveWritePath(ctx.root, relPath);
		if (!existsSync(abs)) continue;
		const content = readFileSync(abs, "utf8");
		const entry = lock.documents[normalizeRelPath(relative(ctx.root, abs))];
		if (!entry) {
			issues.push(
				issue("review-proof", relPath, {
					code: "review-proof-missing",
					message: "document has no recorded review proof",
					remediation:
						"Review the complete document, then run the explicit review attestation command.",
				}),
			);
			continue;
		}
		issues.push(...validateEntry({ ctx, relPath, content, entry }));
	}
	return issues;
}

export const reviewProofRule = { id: "review-proof", run: runReviewProofRule };
