import { relative } from "node:path";
import { collectScanFiles, readFileContent } from "../core/collect.ts";
import type { AuditContext } from "../core/context.ts";
import { type Issue, issue } from "../core/report.ts";
import {
	isReviewDependencyGlob,
	isSafeReviewDependencyPath,
	parseReviewDepsMarkers,
	resolveReviewDependencies,
} from "../core/review-deps.ts";
import { normalizeRelPath } from "../core/shared.ts";

/** Validate opt-in repository dependencies for every scanned document. */
export function runReviewDepsRule(ctx: AuditContext): Issue[] {
	const issues: Issue[] = [];
	for (const abs of collectScanFiles(ctx.config, ctx.root, ctx.skillIndex)) {
		const path = normalizeRelPath(relative(ctx.root, abs));
		for (const marker of parseReviewDepsMarkers(readFileContent(abs))) {
			issues.push(...validateMarker(ctx.root, path, marker.paths));
		}
	}
	return issues;
}

function validateMarker(root: string, path: string, dependencies: string[]): Issue[] {
	if (dependencies.length === 0)
		return [issue("review-deps", path, "review-deps marker missing paths=")];
	return dependencies.flatMap((dependency) => validateDependency(root, path, dependency));
}

function validateDependency(root: string, path: string, dependency: string): Issue[] {
	if (!isSafeReviewDependencyPath(dependency)) {
		return [issue("review-deps", path, `invalid review dependency path: ${dependency}`)];
	}
	try {
		const resolved = resolveReviewDependencies(root, [dependency]);
		if (!isReviewDependencyGlob(dependency) || resolved.targets.length > 0) return [];
		return [
			issue("review-deps", path, {
				code: "review-dependency-glob-empty",
				message: `review dependency glob matches no files: ${dependency}`,
				severity: "warning",
			}),
		];
	} catch (error) {
		return [issue("review-deps", path, error instanceof Error ? error.message : String(error))];
	}
}

export const reviewDepsRule = { id: "review-deps", alwaysRun: true, run: runReviewDepsRule };
