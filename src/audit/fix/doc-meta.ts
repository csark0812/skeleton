import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { AuditContext } from "../core/context.ts";
import type { FixEdit } from "../core/fix.ts";
import { lastGitCommitDate } from "../core/git-meta.ts";
import {
	DOC_META_RE,
	docMetaLastReviewed,
	parseReviewStamp,
	replaceDocMetaLastReviewed,
} from "../core/shared.ts";

export function bumpDocMetaLastReviewed(content: string, gitDate: string): string | null {
	const reviewedStr = docMetaLastReviewed(content);
	if (!reviewedStr) return null;
	const reviewed = parseReviewStamp(reviewedStr);
	const committed = parseReviewStamp(gitDate);
	if (!reviewed || !committed) return null;
	if (committed.day <= reviewed.day) return null;
	return replaceDocMetaLastReviewed(content, gitDate);
}

function docMetaFixForPath(ctx: AuditContext, relPath: string): FixEdit | null {
	const abs = join(ctx.root, relPath);
	if (!existsSync(abs)) return null;
	const content = readFileSync(abs, "utf8");
	if (!DOC_META_RE.test(content)) return null;

	const reviewedStr = docMetaLastReviewed(content);
	if (!reviewedStr) return null;

	if (!parseReviewStamp(reviewedStr)) return null;

	const gitDate = lastGitCommitDate(relPath, ctx.root);
	if (!gitDate) return null;

	const updated = bumpDocMetaLastReviewed(content, gitDate);
	if (!updated) return null;

	return {
		file: relPath,
		description: `last-reviewed ${reviewedStr} → ${gitDate}`,
		content: updated,
	};
}

export function collectDocMetaFixes(ctx: AuditContext): FixEdit[] {
	const edits: FixEdit[] = [];
	for (const relPath of ctx.docMetaPaths) {
		const fix = docMetaFixForPath(ctx, relPath);
		if (fix) edits.push(fix);
	}
	return edits;
}
