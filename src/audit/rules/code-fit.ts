import { relative } from "node:path";
import {
	DEFAULT_CODE_FIT_OVERLAP_MIN,
	DEFAULT_CODE_FIT_SURFACE_CAP,
	evaluateCodeFitDoc,
	parseCodeFitMarkers,
} from "../core/code-fit.ts";
import { collectScanFiles, readFileContent } from "../core/collect.ts";
import type { AuditContext } from "../core/context.ts";
import { type Issue, issue } from "../core/report.ts";
import { normalizeRelPath } from "../core/shared.ts";

/**
 * Docs↔code surface fit. Always discovers marked docs across the full scan
 * perimeter (ignores path-filtered ctx.files) so code drift is still caught.
 */
export function runCodeFitRule(ctx: AuditContext): Issue[] {
	const overlapMin = ctx.config.docsLint?.codeFitOverlapMin ?? DEFAULT_CODE_FIT_OVERLAP_MIN;
	const surfaceCap = ctx.config.docsLint?.codeFitSurfaceCap ?? DEFAULT_CODE_FIT_SURFACE_CAP;
	const options = { root: ctx.root, overlapMin, surfaceCap };

	const corpus = collectScanFiles(ctx.config, ctx.root, ctx.skillIndex);
	const issues: Issue[] = [];

	for (const abs of corpus) {
		const content = readFileContent(abs);
		if (!parseCodeFitMarkers(content).length) continue;
		const rel = normalizeRelPath(relative(ctx.root, abs));
		for (const fit of evaluateCodeFitDoc(rel, content, options)) {
			issues.push(
				issue("code-fit", fit.path, {
					message: fit.message,
					link: fit.link,
					severity: "error",
				}),
			);
		}
	}

	return issues;
}

/** Path-scoped suite membership, but alwaysRun so --paths does not skip it. */
export const codeFitRule = {
	id: "code-fit",
	alwaysRun: true,
	run: runCodeFitRule,
};
