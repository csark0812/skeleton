import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { AuditContext } from "../core/context.ts";
import type { FixEdit } from "../core/fix.ts";
import { lastGitCommitDate } from "../core/git-meta.ts";
import { DOC_META_RE, docMetaLastReviewed, replaceDocMetaLastReviewed } from "../core/shared.ts";

export function bumpDocMetaLastReviewed(content: string, gitDate: string): string | null {
	const reviewedStr = docMetaLastReviewed(content);
	if (!reviewedStr) return null;
	const reviewed = new Date(`${reviewedStr}T00:00:00Z`);
	const committed = new Date(`${gitDate}T00:00:00Z`);
	if (Number.isNaN(reviewed.getTime()) || Number.isNaN(committed.getTime())) return null;
	if (committed.getTime() <= reviewed.getTime()) return null;
	return replaceDocMetaLastReviewed(content, gitDate);
}

export function collectDocMetaFixes(ctx: AuditContext): FixEdit[] {
	const edits: FixEdit[] = [];

	for (const relPath of ctx.docMetaPaths) {
		const abs = join(ctx.root, relPath);
		if (!existsSync(abs)) continue;
		const content = readFileSync(abs, "utf8");
		if (!DOC_META_RE.test(content)) continue;

		const reviewedStr = docMetaLastReviewed(content);
		if (!reviewedStr) continue;

		const reviewed = new Date(`${reviewedStr}T00:00:00Z`);
		if (Number.isNaN(reviewed.getTime())) continue;

		const gitDate = lastGitCommitDate(relPath, ctx.root);
		if (!gitDate) continue;

		const updated = bumpDocMetaLastReviewed(content, gitDate);
		if (!updated) continue;

		edits.push({
			file: relPath,
			description: `last-reviewed ${reviewedStr} → ${gitDate}`,
			content: updated,
		});
	}

	return edits;
}
