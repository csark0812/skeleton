import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { AuditContext } from "../core/context.ts";
import { lastGitCommitDate } from "../core/git-meta.ts";
import { type Issue, issue } from "../core/report.ts";
import { DOC_META_RE, docMetaLastReviewed } from "../core/shared.ts";
import { slugFromPath } from "../core/skill-roots.ts";

function checkDocMetaBanner(relPath: string, content: string): Issue | null {
	if (DOC_META_RE.test(content)) return null;
	return issue("doc-meta", relPath, "missing doc-meta comment (owner + last-reviewed)");
}

interface StaleReviewInput {
	relPath: string;
	content: string;
	today: Date;
	staleDays: number;
}

function checkStaleReview(input: StaleReviewInput): Issue | null {
	const { relPath, content, today, staleDays } = input;
	const reviewedStr = docMetaLastReviewed(content);
	if (!reviewedStr) return null;
	const reviewed = new Date(`${reviewedStr}T00:00:00Z`);
	if (Number.isNaN(reviewed.getTime())) return null;
	const ageDays = (today.getTime() - reviewed.getTime()) / 86_400_000;
	if (ageDays <= staleDays) return null;
	return issue("doc-meta", relPath, {
		message: `doc-meta last-reviewed ${reviewedStr} exceeds re-read cadence (>${staleDays} days) — re-affirm the paper or bump after review`,
		severity: "warning",
	});
}

interface GitFreshnessInput {
	relPath: string;
	content: string;
	root: string;
	lockedSkillSlugs: Set<string>;
}

export function gitFreshnessMessage(reviewedStr: string, gitDate: string): string {
	return `content changed after last-reviewed ${reviewedStr} (git: ${gitDate}) — REQUIRED: re-read the entire document, then bump last-reviewed only if the content is still correct; do not change the date alone`;
}

function checkGitFreshness(input: GitFreshnessInput): Issue | null {
	const { relPath, content, root, lockedSkillSlugs } = input;
	const reviewedStr = docMetaLastReviewed(content);
	if (!reviewedStr) return null;
	const reviewed = new Date(`${reviewedStr}T00:00:00Z`);
	if (Number.isNaN(reviewed.getTime())) return null;

	const slug = slugFromPath(relPath, root);
	if (slug !== null && lockedSkillSlugs.has(slug)) return null;

	const gitDate = lastGitCommitDate(relPath, root);
	if (!gitDate) return null;
	const committed = new Date(`${gitDate}T00:00:00Z`);
	if (Number.isNaN(committed.getTime())) return null;
	if (committed.getTime() <= reviewed.getTime()) return null;

	return issue("doc-meta", relPath, {
		message: gitFreshnessMessage(reviewedStr, gitDate),
		severity: "warning",
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

		const stale = checkStaleReview({
			relPath,
			content,
			today,
			staleDays: ctx.config.daysUntilStale,
		});
		if (stale) issues.push(stale);

		const git = checkGitFreshness({
			relPath,
			content,
			root: ctx.root,
			lockedSkillSlugs: ctx.lockedSkillSlugs,
		});
		if (git) issues.push(git);
	}

	return issues;
}

export const docMetaRule = { id: "doc-meta", run: runDocMetaRule };
