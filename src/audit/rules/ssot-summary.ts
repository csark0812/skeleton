import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { AuditContext } from "../core/context.ts";
import { type Issue, issue } from "../core/report.ts";
import {
	DEFAULT_BETTER_MATCH_MARGIN,
	DEFAULT_SSOT_OVERLAP_MIN,
	evaluateSsotFit,
	type FitFile,
} from "../core/ssot-fit.ts";

export function runSsotSummaryRule(ctx: AuditContext): Issue[] {
	const overlapMin = ctx.config.docsLint?.ssotOverlapMin ?? DEFAULT_SSOT_OVERLAP_MIN;
	const margin = ctx.config.docsLint?.ssotBetterMatchMargin ?? DEFAULT_BETTER_MATCH_MARGIN;
	const phraseCheck = ctx.config.docsLint?.ssotPhraseCheck !== false;

	const files: FitFile[] = ctx.ssotEntries.map((entry) => ({
		path: entry.path,
		summary: entry.summary,
		content: readFileSync(join(ctx.root, entry.path), "utf8"),
	}));

	return evaluateSsotFit(files, {
		overlapMin,
		betterMatchMargin: margin,
		phraseCheck,
	}).map((fit) =>
		issue("ssot-summary", fit.path, {
			message: fit.message,
			severity: "warning",
			link: fit.otherPath,
		}),
	);
}

export const ssotSummaryRule = { id: "ssot-summary", run: runSsotSummaryRule };

export {
	buildEvidenceText,
	ssotBodyOverlap,
	ssotEvidenceOverlap,
} from "../core/ssot-fit.ts";
