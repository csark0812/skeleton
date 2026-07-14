import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { AuditContext } from "../core/context.ts";
import type { FixEdit } from "../core/fix.ts";
import { lastGitCommitDate } from "../core/git-meta.ts";
import { DOC_META_LAST_REVIEWED_RE, DOC_META_RE } from "../core/shared.ts";

export function bumpDocMetaLastReviewed(content: string, gitDate: string): string | null {
	const match = DOC_META_LAST_REVIEWED_RE.exec(content);
	if (!match?.[1]) return null;
	const reviewed = new Date(`${match[1]}T00:00:00Z`);
	const committed = new Date(`${gitDate}T00:00:00Z`);
	if (Number.isNaN(reviewed.getTime()) || Number.isNaN(committed.getTime())) return null;
	if (committed.getTime() <= reviewed.getTime()) return null;
	const updated = content.replace(DOC_META_LAST_REVIEWED_RE, `last-reviewed=${gitDate}`);
	return updated === content ? null : updated;
}

export function collectDocMetaFixes(ctx: AuditContext): FixEdit[] {
	const edits: FixEdit[] = [];

	for (const relPath of ctx.docMetaPaths) {
		const abs = join(ctx.root, relPath);
		if (!existsSync(abs)) continue;
		const content = readFileSync(abs, "utf8");
		if (!DOC_META_RE.test(content)) continue;

		const match = DOC_META_LAST_REVIEWED_RE.exec(content);
		if (!match?.[1]) continue;

		const reviewed = new Date(`${match[1]}T00:00:00Z`);
		if (Number.isNaN(reviewed.getTime())) continue;

		const gitDate = lastGitCommitDate(relPath, ctx.root);
		if (!gitDate) continue;

		const updated = bumpDocMetaLastReviewed(content, gitDate);
		if (!updated) continue;

		edits.push({
			file: relPath,
			description: `last-reviewed ${match[1]} → ${gitDate}`,
			content: updated,
		});
	}

	return edits;
}
