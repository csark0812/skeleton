import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { readFileContent, relPath } from "../core/collect.ts";
import type { AuditContext } from "../core/context.ts";
import {
	extractHeadingSlugs,
	extractLinksFromMarkdown,
	slugifyAnchor,
} from "../core/markdown.ts";
import { type Issue, issue } from "../core/report.ts";
import {
	isExternalLink,
	isPlaceholderLink,
	SKILL_LINK_IN_TARGET_RE,
} from "../core/shared.ts";

function resolveLink(sourceFile: string, target: string): string {
	const withoutAnchor = target.split("#")[0]?.split("?")[0] ?? "";
	if (!withoutAnchor) return sourceFile;
	return resolve(dirname(sourceFile), withoutAnchor);
}

function validateTarget(
	ctx: AuditContext,
	sourceFile: string,
	target: string,
	linkLabel: string,
): Issue[] {
	const issues: Issue[] = [];
	if (isExternalLink(target) && !target.startsWith("#")) return issues;
	if (isPlaceholderLink(target)) return issues;

	const relSource = relPath(sourceFile, ctx.root);
	const anchor = target.includes("#")
		? (target.split("#")[1]?.split("?")[0] ?? "")
		: "";
	const pathPart = target.split("#")[0]?.split("?")[0] ?? "";
	const resolved = resolveLink(sourceFile, target);
	const relTarget = relPath(resolved, ctx.root);

	const skillMatch = SKILL_LINK_IN_TARGET_RE.exec(target);
	if (skillMatch?.[1] && ctx.retiredSkills.has(skillMatch[1])) {
		issues.push(
			issue(
				"links",
				relSource,
				`references retired skill "${skillMatch[1]}/SKILL.md"`,
				{
					link: linkLabel,
				},
			),
		);
		return issues;
	}

	if (target.includes("/SKILL.md")) {
		const slug = skillMatch?.[1];
		if (
			slug &&
			!existsSync(join(ctx.root, ".claude/skills", slug, "SKILL.md"))
		) {
			issues.push(
				issue("links", relSource, `missing skill "${slug}/SKILL.md"`, {
					link: linkLabel,
				}),
			);
			return issues;
		}
	}

	if (
		(target.includes(".claude/agents/") ||
			target.includes(".cursor/agents/")) &&
		target.endsWith(".md")
	) {
		const agentPath = resolved.endsWith(".md") ? resolved : `${resolved}.md`;
		if (!existsSync(agentPath)) {
			issues.push(
				issue("links", relSource, "missing agent file", { link: linkLabel }),
			);
		}
		return issues;
	}

	if (pathPart && !existsSync(resolved)) {
		issues.push(
			issue("links", relSource, `broken link → ${relTarget}`, {
				link: linkLabel,
			}),
		);
		return issues;
	}

	if (anchor && existsSync(resolved)) {
		const targetContent = readFileSync(resolved, "utf8");
		const slugs = extractHeadingSlugs(targetContent, resolved);
		const anchorSlug = slugifyAnchor(anchor);
		if (!slugs.has(anchorSlug)) {
			issues.push(
				issue(
					"links",
					relSource,
					`broken anchor → #${anchor} in ${relTarget}`,
					{
						link: linkLabel,
					},
				),
			);
		}
	}

	return issues;
}

export function runLinksRule(ctx: AuditContext): Issue[] {
	const issues: Issue[] = [];
	for (const filePath of ctx.files) {
		const content = readFileContent(filePath);
		const links = extractLinksFromMarkdown(content, filePath);
		for (const { target, line } of links) {
			const linkLabel = line ? `line ${line}` : target;
			issues.push(...validateTarget(ctx, filePath, target, linkLabel));
		}
	}
	return issues;
}

export const linksRule = { id: "links", run: runLinksRule };
