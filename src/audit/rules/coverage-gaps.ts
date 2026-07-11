import {
	collectCoverageCandidateFiles,
	collectScanFiles,
	relPath,
} from "../core/collect.ts";
import type { AuditContext } from "../core/context.ts";
import { COVERAGE_BUILTIN_EXCLUDES } from "../config/load.ts";
import { type Issue, issue } from "../core/report.ts";

export function runCoverageGapsRule(ctx: AuditContext): Issue[] {
	const exclude = [...COVERAGE_BUILTIN_EXCLUDES, ...ctx.config.scan.exclude];
	const candidates = collectCoverageCandidateFiles(ctx.root, exclude);
	const scanned = new Set(
		collectScanFiles(ctx.config, ctx.root, ctx.skillIndex).map((f) =>
			relPath(f, ctx.root),
		),
	);
	const issues: Issue[] = [];

	for (const rel of candidates) {
		if (scanned.has(rel)) continue;
		issues.push(
			issue(
				"coverage-gaps",
				rel,
				"markdown outside audit scan perimeter — extend .skeleton/config.yaml scan.include",
				{ severity: "warning" },
			),
		);
	}

	return issues;
}

export const coverageGapsRule = {
	id: "coverage-gaps",
	run: runCoverageGapsRule,
};
