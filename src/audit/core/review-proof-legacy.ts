import { globSync } from "tinyglobby";
import type { SkeletonConfig } from "../config/types.ts";
import { type FileSource, readRepoText } from "./repo-files.ts";
import { resolveReviewDependencies, reviewDependencyPatterns } from "./review-deps.ts";
import {
	dependencyDigest,
	fullDocumentDigest,
	isPackageManifest,
	manifestWithoutReleaseVersion,
	sha256,
} from "./review-digest.ts";
import { normalizeRelPath } from "./shared.ts";

/** Skeleton 5 kept every document in one JSON lock. Read only to migrate it. */
export const LEGACY_REVIEW_LOCKFILE = ".skeleton/review-lock.json";
/** Skeleton 6 kept one JSON proof per document. Read only to migrate it. */
export const LEGACY_REVIEW_PROOF_DIR = ".skeleton/reviews";

/** A recorded review from either legacy format, with the digests that format used. */
interface LegacyReview {
	document: string;
	documentHash: string;
	reviewDependencies: Record<string, string>;
	format: 2 | 3;
}

export interface LegacyReviewProof {
	/** Repo-relative legacy files that exist and must be removed after migration. */
	files: string[];
	reviews: LegacyReview[];
	/** A legacy file that could not be parsed, or null. */
	malformed: string | null;
}

export function legacyLockPath(config: Pick<SkeletonConfig, "reviewProof">): string {
	return normalizeRelPath(config.reviewProof?.lockfile ?? LEGACY_REVIEW_LOCKFILE);
}

export function legacyProofDir(config: Pick<SkeletonConfig, "reviewProof">): string {
	return normalizeRelPath(config.reviewProof?.dir ?? LEGACY_REVIEW_PROOF_DIR).replace(/\/$/, "");
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFullHash(value: unknown): value is string {
	return typeof value === "string" && /^sha256:[a-f0-9]{64}$/.test(value);
}

function parseDependencies(value: unknown): Record<string, string> | null {
	if (!isRecord(value)) return null;
	const out: Record<string, string> = {};
	for (const [target, targetHash] of Object.entries(value)) {
		if (!isFullHash(targetHash)) return null;
		out[normalizeRelPath(target)] = targetHash;
	}
	return out;
}

function parseLock(content: string): LegacyReview[] | null {
	try {
		const parsed: unknown = JSON.parse(content);
		if (!isRecord(parsed) || parsed.version !== 2 || !isRecord(parsed.documents)) return null;
		const reviews: LegacyReview[] = [];
		for (const [document, value] of Object.entries(parsed.documents)) {
			if (!(isRecord(value) && isFullHash(value.documentHash))) return null;
			const reviewDependencies = parseDependencies(value.reviewDependencies);
			if (!reviewDependencies) return null;
			reviews.push({ document, documentHash: value.documentHash, reviewDependencies, format: 2 });
		}
		return reviews;
	} catch {
		return null;
	}
}

function parseShard(document: string, content: string): LegacyReview | null {
	try {
		const parsed: unknown = JSON.parse(content);
		if (!isRecord(parsed) || parsed.version !== 3 || !isFullHash(parsed.documentHash)) return null;
		const reviewDependencies = parseDependencies(parsed.reviewDependencies);
		if (!reviewDependencies) return null;
		return { document, documentHash: parsed.documentHash, reviewDependencies, format: 3 };
	} catch {
		return null;
	}
}

/** Find and parse every legacy proof file in the repository. */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: both legacy formats are found and parsed in one place so migration sees every legacy file
export function loadLegacyReviewProof(input: {
	root: string;
	config: Pick<SkeletonConfig, "reviewProof">;
	source?: FileSource;
}): LegacyReviewProof {
	const source = input.source ?? "worktree";
	const result: LegacyReviewProof = { files: [], reviews: [], malformed: null };
	const lockRel = legacyLockPath(input.config);
	const lock = readRepoText(input.root, lockRel, source);
	if (lock !== null) {
		result.files.push(lockRel);
		const reviews = parseLock(lock);
		if (reviews) result.reviews.push(...reviews);
		else result.malformed ??= lockRel;
	}
	const dir = legacyProofDir(input.config);
	for (const match of globSync(`${dir}/**/*.json`, {
		cwd: input.root,
		dot: true,
		onlyFiles: true,
	})) {
		const shardRel = normalizeRelPath(match);
		const content = readRepoText(input.root, shardRel, source);
		if (content === null) continue;
		result.files.push(shardRel);
		const review = parseShard(shardRel.slice(dir.length + 1, -".json".length), content);
		if (review) result.reviews.push(review);
		else result.malformed ??= shardRel;
	}
	return result;
}

/** How each legacy format digested a dependency. */
function legacyDependencyMatches(review: LegacyReview, target: string, content: string): boolean {
	const recorded = review.reviewDependencies[target];
	if (recorded === undefined) return false;
	if (review.format === 3) return recorded === dependencyDigest(target, content);
	if (recorded === sha256(content)) return true;
	if (!isPackageManifest(target)) return false;
	const manifest = manifestWithoutReleaseVersion(content);
	return manifest !== null && recorded === sha256(manifest);
}

/** True when a legacy review still proves a reread of the current bytes. */
export function legacyReviewVerifies(root: string, review: LegacyReview): boolean {
	const content = readRepoText(root, review.document, "worktree");
	if (content === null) return false;
	const documentHash = review.format === 3 ? fullDocumentDigest(content) : sha256(content);
	if (documentHash !== review.documentHash) return false;
	const targets = resolveReviewDependencies(root, reviewDependencyPatterns(content)).targets;
	if (JSON.stringify(targets) !== JSON.stringify(Object.keys(review.reviewDependencies).sort())) {
		return false;
	}
	return targets.every((target) => {
		const current = readRepoText(root, target, "worktree");
		return current !== null && legacyDependencyMatches(review, target, current);
	});
}
