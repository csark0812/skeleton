import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { AuditContext } from "../core/context.ts";
import { type Issue, issue } from "../core/report.ts";
import { reviewCommitDay } from "../core/review-proof.ts";
import { DOC_META_RE, hasLegacyReviewDate } from "../core/shared.ts";

function checkDocMetaBanner(relPath: string, content: string): Issue | null {
	if (DOC_META_RE.test(content)) return null;
	return issue("doc-meta", relPath, "missing doc-meta comment (<!-- doc-meta: owner=<team> -->)");
}

function checkLegacyReviewDate(relPath: string, content: string): Issue | null {
	if (!hasLegacyReviewDate(content)) return null;
	return issue("doc-meta", relPath, {
		code: "legacy-review-date",
		message: "doc-meta still carries a last-reviewed date; review proof no longer stores dates",
		severity: "warning",
		remediation: "Run `skeleton audit docs --fix=review-proof` to remove legacy dates.",
	});
}

/** Age of the last committed review: the commit that last changed the document's proof entry. */
function checkStaleReview(input: {
	ctx: AuditContext;
	relPath: string;
	today: Date;
}): Issue | null {
	const { ctx, relPath, today } = input;
	const committed = reviewCommitDay(ctx.root, ctx.config, relPath);
	if (!committed) return null;
	const ageDays = (today.getTime() - Date.parse(`${committed}T00:00:00Z`)) / 86_400_000;
	if (!(ageDays > ctx.config.daysUntilStale)) return null;
	return issue("doc-meta", relPath, {
		code: "review-cadence-exceeded",
		message: `last review was committed ${committed}, beyond the re-read cadence (>${ctx.config.daysUntilStale} days)`,
		severity: "warning",
		remediation: "Re-read the entire document, then attest it again.",
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
		const legacy = checkLegacyReviewDate(relPath, content);
		if (legacy) issues.push(legacy);
		const stale = checkStaleReview({ ctx, relPath, today });
		if (stale) issues.push(stale);
	}

	return issues;
}

export const docMetaRule = { id: "doc-meta", run: runDocMetaRule };
