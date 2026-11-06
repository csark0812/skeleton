import { basename, extname } from "node:path";

/**
 * How much review a change gets. The kind of change decides it, not its size: in the efficacy
 * fixtures a one-line code regression was the defect a single review missed most often
 * (docs/developer/efficacy.md, `final2`), so any code, test, or config change keeps two reviews.
 */
export type ReviewTier = "light" | "full" | "configured";

/** The reviewer count for one bundle, with the reasons printed to the author. */
export interface ReviewPlan {
	tier: ReviewTier;
	reviewers: number;
	reasons: string[];
}

/** One path the review covers, with its added plus removed lines, or null for a binary file. */
export interface ReviewedPath {
	path: string;
	lines: number | null;
}

/**
 * Two independent reviews by default. A single review missed 2% of seeded defects at random; two
 * merged reviews missed 0.9%, at twice the tokens (docs/developer/efficacy.md, "Two merged reviews").
 */
export const DEFAULT_REVIEWERS = 2;

/** One review for a prose-only change. Not measured: no efficacy fixture is prose-only. */
export const LIGHT_REVIEWERS = 1;

/** Largest prose-only change that gets one review. An unmeasured starting value. */
export const LIGHT_MAX_PROSE_LINES = 300;

const PROSE_EXTENSIONS = new Set([".md", ".mdx"]);

/** Markdown that steers an agent or a reviewer, so a change to it changes behavior. */
const INSTRUCTION_FILES = new Set(["SKILL.md", "AGENTS.md", "CLAUDE.md", "REVIEW.md"]);

export function isInstructionFileName(path: string): boolean {
	return INSTRUCTION_FILES.has(basename(path));
}

function isProse(path: string, isInstructionFile: (path: string) => boolean): boolean {
	return PROSE_EXTENSIONS.has(extname(path).toLowerCase()) && !isInstructionFile(path);
}

function full(reason: string): ReviewPlan {
	return { tier: "full", reviewers: DEFAULT_REVIEWERS, reasons: [reason] };
}

/** Decide the reviewer count once, for both the packaged skill and `review prepare --run`. */
export function reviewPlan(input: {
	/** Paths in the reviewed diff, without lockfiles and other paths omitted from it. */
	paths: ReviewedPath[];
	isInstructionFile: (path: string) => boolean;
	humanReviewRequired: string[];
	documentsToReread: number;
	configuredReviewers?: number;
}): ReviewPlan {
	if (input.configuredReviewers !== undefined) {
		return {
			tier: "configured",
			reviewers: input.configuredReviewers,
			reasons: ["[review] reviewers in skeleton.toml"],
		};
	}
	if (input.humanReviewRequired.length > 0) return full("human-review paths changed");
	if (input.documentsToReread > 0) return full("documents to re-read");
	if (input.paths.length === 0) return full("no reviewable paths");
	const notProse = input.paths.filter((item) => !isProse(item.path, input.isInstructionFile));
	if (notProse.length > 0) return full(`not prose-only: ${notProse[0]?.path}`);
	if (input.paths.some((item) => item.lines === null)) return full("binary prose file");
	const lines = input.paths.reduce((sum, item) => sum + (item.lines ?? 0), 0);
	if (lines > LIGHT_MAX_PROSE_LINES) {
		return full(`${lines} prose lines, over ${LIGHT_MAX_PROSE_LINES}`);
	}
	return {
		tier: "light",
		reviewers: LIGHT_REVIEWERS,
		reasons: [`prose only, ${lines} lines`],
	};
}

/** `review prepare: full review, 2 reviewers (not prose-only: src/a.ts)`. */
export function formatReviewPlan(plan: ReviewPlan): string {
	const count = `${plan.reviewers} reviewer${plan.reviewers === 1 ? "" : "s"}`;
	return `review prepare: ${plan.tier} review, ${count} (${plan.reasons.join("; ")}); start exactly that many`;
}
