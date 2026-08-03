import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { readFileContent, relPath } from "../core/collect.ts";
import type { AuditContext } from "../core/context.ts";
import { extractHeadingSlugs, extractLinksFromMarkdown, slugifyAnchor } from "../core/markdown.ts";
import { type Issue, issue } from "../core/report.ts";
import { isExternalLink, isPlaceholderLink, SKILL_LINK_IN_TARGET_RE } from "../core/shared.ts";
import { resolveSkillPath } from "../core/skill-roots.ts";

function resolveLink(sourceFile: string, target: string): string {
	const withoutAnchor = target.split("#")[0]?.split("?")[0] ?? "";
	if (!withoutAnchor) return sourceFile;
	return resolve(dirname(sourceFile), withoutAnchor);
}

interface ValidateTargetInput {
	ctx: AuditContext;
	sourceFile: string;
	target: string;
	linkLabel: string;
}

function checkRetiredSkill(input: ValidateTargetInput): Issue | null {
	const skillMatch = SKILL_LINK_IN_TARGET_RE.exec(input.target);
	const slug = skillMatch?.[1];
	if (!(slug && input.ctx.retiredSkills.has(slug))) return null;
	return issue("links", relPath(input.sourceFile, input.ctx.root), {
		message: `references retired skill "${slug}/SKILL.md"`,
		link: input.linkLabel,
	});
}

function checkMissingSkill(input: ValidateTargetInput, relSource: string): Issue | null {
	if (!input.target.includes("/SKILL.md")) return null;
	const slug = SKILL_LINK_IN_TARGET_RE.exec(input.target)?.[1];
	if (!(slug && !resolveSkillPath(input.ctx.skillIndex, input.ctx.root, slug))) return null;
	return issue("links", relSource, {
		message: `missing skill "${slug}/SKILL.md"`,
		link: input.linkLabel,
	});
}

function checkAgentFile(
	input: ValidateTargetInput,
	resolved: string,
	relSource: string,
): Issue | null {
	if (
		!(
			(input.target.includes(".claude/agents/") || input.target.includes(".cursor/agents/")) &&
			input.target.endsWith(".md")
		)
	) {
		return null;
	}
	const agentPath = resolved.endsWith(".md") ? resolved : `${resolved}.md`;
	if (existsSync(agentPath)) return null;
	return issue("links", relSource, { message: "missing agent file", link: input.linkLabel });
}

interface BrokenPathInput {
	input: ValidateTargetInput;
	pathPart: string;
	resolved: string;
	relSource: string;
	relTarget: string;
}

function checkBrokenPath(ctx: BrokenPathInput): Issue | null {
	const { input, pathPart, resolved, relSource, relTarget } = ctx;
	if (!(pathPart && !existsSync(resolved))) return null;
	return issue("links", relSource, {
		message: `broken link → ${relTarget}`,
		link: input.linkLabel,
	});
}

interface BrokenAnchorInput {
	input: ValidateTargetInput;
	anchor: string;
	resolved: string;
	relSource: string;
	relTarget: string;
}

function checkBrokenAnchor(ctx: BrokenAnchorInput): Issue | null {
	const { input, anchor, resolved, relSource, relTarget } = ctx;
	if (!(anchor && existsSync(resolved))) return null;
	const targetContent = readFileSync(resolved, "utf8");
	const slugs = extractHeadingSlugs(targetContent, resolved);
	const anchorSlug = slugifyAnchor(anchor);
	if (slugs.has(anchorSlug)) return null;
	return issue("links", relSource, {
		message: `broken anchor → #${anchor} in ${relTarget}`,
		link: input.linkLabel,
	});
}

function resolveTargetParts(sourceFile: string, target: string, root: string) {
	const relSource = relPath(sourceFile, root);
	const anchor = target.includes("#") ? (target.split("#")[1]?.split("?")[0] ?? "") : "";
	const pathPart = target.split("#")[0]?.split("?")[0] ?? "";
	const resolved = resolveLink(sourceFile, target);
	const relTarget = relPath(resolved, root);
	return { relSource, anchor, pathPart, resolved, relTarget };
}

function validateTarget(input: ValidateTargetInput): Issue[] {
	const { ctx, sourceFile, target } = input;
	if (isExternalLink(target) && !target.startsWith("#")) return [];
	if (isPlaceholderLink(target)) return [];

	const parts = resolveTargetParts(sourceFile, target, ctx.root);
	const retired = checkRetiredSkill(input);
	if (retired) return [retired];

	const missingSkill = checkMissingSkill(input, parts.relSource);
	if (missingSkill) return [missingSkill];

	const agent = checkAgentFile(input, parts.resolved, parts.relSource);
	if (agent) return [agent];

	const brokenPath = checkBrokenPath({ input, ...parts });
	if (brokenPath) return [brokenPath];

	const brokenAnchor = checkBrokenAnchor({ input, ...parts });
	return brokenAnchor ? [brokenAnchor] : [];
}

export function runLinksRule(ctx: AuditContext): Issue[] {
	const issues: Issue[] = [];
	for (const filePath of ctx.files) {
		const content = readFileContent(filePath);
		const links = extractLinksFromMarkdown(content, filePath);
		for (const { target, line } of links) {
			const linkLabel = line ? `line ${line}` : target;
			issues.push(...validateTarget({ ctx, sourceFile: filePath, target, linkLabel }));
		}
	}
	return issues;
}

export const linksRule = { id: "links", run: runLinksRule };
