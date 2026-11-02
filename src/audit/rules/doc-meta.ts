import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { AuditContext } from "../core/context.ts";
import { lastCommitDay } from "../core/git-meta.ts";
import { type Issue, issue } from "../core/report.ts";
import { DOC_META_RE } from "../core/shared.ts";

function checkDocMetaBanner(relPath: string, content: string): Issue | null {
	if (DOC_META_RE.test(content)) return null;
	return issue("doc-meta", relPath, "missing doc-meta comment (<!-- doc-meta: owner=<team> -->)");
}

/** Age of the document's last commit: nothing records reviews, so an edit is the last review. */
function checkStaleReview(input: {
	ctx: AuditContext;
	relPath: string;
	today: Date;
}): Issue | null {
	const { ctx, relPath, today } = input;
	const committed = lastCommitDay(ctx.root, relPath);
	if (!committed) return null;
	const ageDays = (today.getTime() - Date.parse(`${committed}T00:00:00Z`)) / 86_400_000;
	if (!(ageDays > ctx.config.daysUntilStale)) return null;
	return issue("doc-meta", relPath, {
		code: "review-cadence-exceeded",
		message: `last changed ${committed}, beyond the re-read cadence (>${ctx.config.daysUntilStale} days)`,
		severity: "warning",
		remediation:
			"Re-read the entire document against its sources and commit any correction; raise daysUntilStale if the cadence is too tight.",
	});
}

export function runDocMetaRule(ctx: AuditContext): Issue[] {
	const issues: Issue[] = [];
	const today = new Date();

	for (const relPath of ctx.docMetaPaths) {
		const abs = join(ctx.root, relPath);
		if (!existsSync(abs)) continue;
		const content = readFileSync(abs, "utf8");

		const banner = checkDocMetaBanner(relPath, content);
		if (banner) {
			issues.push(banner);
			continue;
		}
		const stale = checkStaleReview({ ctx, relPath, today });
		if (stale) issues.push(stale);
	}

	return issues;
}

export const docMetaRule = { id: "doc-meta", run: runDocMetaRule };
