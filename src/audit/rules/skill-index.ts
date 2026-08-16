import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { isGeneratedReference } from "../../references/constants.ts";
import { nonPublicSkills } from "../config/load.ts";
import type { AuditContext } from "../core/context.ts";
import { type Issue, issue } from "../core/report.ts";
import { SKILL_LINK_RE } from "../core/shared.ts";
import {
	listOwnedSkillSlugs,
	listSkillSlugs,
	resolveSkillPath,
	type SkillIndex,
	type SkillRoot,
} from "../core/skill-roots.ts";

function walkSkillMarkdown(dir: string): string[] {
	const files: string[] = [];
	if (!existsSync(dir)) return files;
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		if (entry.name.startsWith(".")) continue;
		const fullPath = join(dir, entry.name);
		if (entry.isDirectory()) {
			files.push(...walkSkillMarkdown(fullPath));
			continue;
		}
		if (entry.name.endsWith(".md")) files.push(fullPath);
	}
	return files;
}

function parseReadmeTaxonomySlugs(content: string): string[] {
	const slugs: string[] = [];
	const taxonomyStart = content.indexOf("## Taxonomy");
	if (taxonomyStart < 0) return slugs;
	const internalStart = content.indexOf("## Internal");
	const taxonomyBlock =
		internalStart > taxonomyStart
			? content.slice(taxonomyStart, internalStart)
			: content.slice(taxonomyStart);
	for (const match of taxonomyBlock.matchAll(SKILL_LINK_RE)) {
		const slug = match[1];
		if (slug && !slugs.includes(slug)) slugs.push(slug);
	}
	return slugs;
}

function scanFileForSkillLinks(ctx: AuditContext, filePath: string, index: SkillIndex): Issue[] {
	const issues: Issue[] = [];
	const rel = relative(ctx.root, filePath).replace(/\\/g, "/");
	const content = readFileSync(filePath, "utf8");
	if (isGeneratedReference(content)) return issues;
	for (const match of content.matchAll(SKILL_LINK_RE)) {
		const slug = match[1];
		if (!slug) continue;

		if (!resolveSkillPath(index, ctx.root, slug)) {
			issues.push(issue("skill-index", rel, `links missing skill "${slug}/SKILL.md"`));
		}
	}
	return issues;
}

interface TaxonomyReadmeInput {
	ctx: AuditContext;
	index: SkillIndex;
	skillRoot: SkillRoot;
	diskSlugs: string[];
	nonPublic: Set<string>;
}

function taxonomyIssuesForReadme(input: TaxonomyReadmeInput): Issue[] {
	const { ctx, index, skillRoot, diskSlugs, nonPublic } = input;
	const readmePath = join(ctx.root, skillRoot.relPath, "README.md");
	if (!existsSync(readmePath)) return [];

	const readme = readFileSync(readmePath, "utf8");
	if (!readme.includes("## Taxonomy")) return [];

	const taxonomySlugs = parseReadmeTaxonomySlugs(readme);
	const nestedSlugs = diskSlugs.filter((slug) =>
		existsSync(join(ctx.root, skillRoot.relPath, slug, "SKILL.md")),
	);
	const foreign = new Set(index.foreignSlugs);
	const publicSlugs = nestedSlugs.filter((slug) => !(nonPublic.has(slug) || foreign.has(slug)));
	const relReadme = `${skillRoot.relPath}/README.md`;
	const issues: Issue[] = [];

	for (const slug of publicSlugs) {
		if (!taxonomySlugs.includes(slug)) {
			issues.push(issue("skill-index", relReadme, `taxonomy missing public skill "${slug}"`));
		}
	}
	for (const slug of taxonomySlugs) {
		if (!nestedSlugs.includes(slug)) {
			issues.push(
				issue("skill-index", relReadme, `taxonomy lists skill "${slug}" with no SKILL.md on disk`),
			);
		}
	}
	return issues;
}

function validateReadmeTaxonomy(
	ctx: AuditContext,
	index: SkillIndex,
	diskSlugs: string[],
): Issue[] {
	const issues: Issue[] = [];
	const nonPublic = new Set(nonPublicSkills(ctx.config));
	for (const skillRoot of index.roots) {
		if (skillRoot.kind !== "nested") continue;
		issues.push(...taxonomyIssuesForReadme({ ctx, index, skillRoot, diskSlugs, nonPublic }));
	}
	return issues;
}

function slugsForRoot(skillRoot: SkillRoot, index: SkillIndex, owned: Set<string>): string[] {
	return skillRoot.kind === "nested"
		? index.ownedSlugs
		: index.flatSlugs.filter((slug) => owned.has(slug));
}

interface AuditSkillRootInput {
	ctx: AuditContext;
	index: SkillIndex;
	skillRoot: SkillRoot;
	owned: Set<string>;
}

function auditSkillRoot(input: AuditSkillRootInput): Issue[] {
	const { ctx, index, skillRoot, owned } = input;
	const issues: Issue[] = [];
	const base = skillRoot.kind === "nested" ? join(ctx.root, skillRoot.relPath) : ctx.root;
	for (const slug of slugsForRoot(skillRoot, index, owned)) {
		const skillDir = join(base, slug);
		if (!existsSync(skillDir)) continue;
		for (const skillMd of walkSkillMarkdown(skillDir)) {
			issues.push(...scanFileForSkillLinks(ctx, skillMd, index));
		}
	}
	return issues;
}

function auditOwnedSkillFiles(ctx: AuditContext, index: SkillIndex): Issue[] {
	const owned = new Set(index.ownedSlugs);
	const issues: Issue[] = [];
	for (const skillRoot of index.roots) {
		issues.push(...auditSkillRoot({ ctx, index, skillRoot, owned }));
	}
	return issues;
}

export function runSkillIndexRule(ctx: AuditContext): Issue[] {
	const issues: Issue[] = [];
	const index = ctx.skillIndex;
	const diskSlugs = listSkillSlugs(index);

	for (const warning of index.provenance.warnings) {
		issues.push(
			issue("skill-index", index.provenance.lockfile ?? "skills-lock.json", {
				message: `skill provenance: ${warning}`,
				severity: "warning",
			}),
		);
	}

	issues.push(...validateReadmeTaxonomy(ctx, index, diskSlugs));
	issues.push(...auditOwnedSkillFiles(ctx, index));

	return issues;
}

export const skillIndexRule = { id: "skill-index", run: runSkillIndexRule };

export function skillCountOnDisk(ctx: AuditContext): number {
	return listOwnedSkillSlugs(ctx.skillIndex).length;
}

/** Success-suffix detail: owned audited vs foreign ignored. */
export function skillAuditSuffix(ctx: AuditContext): string {
	const owned = listOwnedSkillSlugs(ctx.skillIndex).length;
	const foreign = ctx.skillIndex.foreignSlugs.length;
	if (foreign === 0) return ` (${owned} skills on disk)`;
	return ` (${owned} owned skills audited, ${foreign} foreign ignored)`;
}
