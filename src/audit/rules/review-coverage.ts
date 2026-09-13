import type { AuditContext } from "../core/context.ts";
import { type Issue, issue } from "../core/report.ts";
import {
	collectReviewCoverageFiles,
	collectReviewDependencyPatterns,
	pathHasReviewOwner,
} from "../core/review-coverage.ts";

export function runReviewCoverageRule(ctx: AuditContext): Issue[] {
	const patterns = collectReviewDependencyPatterns({
		root: ctx.root,
		config: ctx.config,
		skillIndex: ctx.skillIndex,
		fileSource: ctx.fileSource,
	});
	return collectReviewCoverageFiles(ctx.root, ctx.config)
		.filter((path) => !pathHasReviewOwner(path, patterns))
		.map((path) =>
			issue("review-coverage", path, {
				code: "review-coverage-gap",
				message:
					"file has no owning document; add a review-deps path or glob on the paper that describes it",
			}),
		);
}

export const reviewCoverageRule = {
	id: "review-coverage",
	global: true,
	run: runReviewCoverageRule,
};
