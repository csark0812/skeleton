import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { AuditContext } from "../core/context.ts";
import { lastGitCommitDate } from "../core/git-meta.ts";
import { type Issue, issue } from "../core/report.ts";
import { DOC_META_RE, docMetaLastReviewed } from "../core/shared.ts";

export function runDocMetaRule(ctx: AuditContext): Issue[] {
	const issues: Issue[] = [];
	const today = new Date();

	for (const relPath of ctx.docMetaPaths) {
		const abs = join(ctx.root, relPath);
		if (!existsSync(abs)) continue;
		const content = readFileSync(abs, "utf8");
		if (!DOC_META_RE.test(content)) {
			issues.push(issue("doc-meta", relPath, "missing doc-meta comment (owner + last-reviewed)"));
			continue;
		}
		const reviewedStr = docMetaLastReviewed(content);
		if (!reviewedStr) continue;
		const reviewed = new Date(`${reviewedStr}T00:00:00Z`);
		if (Number.isNaN(reviewed.getTime())) continue;
		const ageDays = (today.getTime() - reviewed.getTime()) / 86_400_000;
		if (ageDays > ctx.config.daysUntilStale) {
			issues.push(
				issue(
					"doc-meta",
					relPath,
					`doc-meta last-reviewed ${reviewedStr} is stale (>${ctx.config.daysUntilStale} days)`,
					{ severity: "warning" },
				),
			);
		}

		const gitDate = lastGitCommitDate(relPath, ctx.root);
		if (!gitDate) continue;
		const committed = new Date(`${gitDate}T00:00:00Z`);
		if (Number.isNaN(committed.getTime())) continue;
		if (committed.getTime() > reviewed.getTime()) {
			issues.push(
				issue(
					"doc-meta",
					relPath,
					`content changed after last-reviewed ${reviewedStr} (git: ${gitDate}) — bump last-reviewed or confirm review`,
					{ severity: "warning" },
				),
			);
		}
	}

	return issues;
}

export const docMetaRule = { id: "doc-meta", run: runDocMetaRule };
