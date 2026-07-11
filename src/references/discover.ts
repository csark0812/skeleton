import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { buildSkillIndex } from "../audit/core/skill-roots.ts";
import { normalizeRelPath } from "../audit/core/shared.ts";
import {
	CANONICAL_REFS_DIR,
	SHARED_REF_LINK_RE,
	isGeneratedReference,
} from "./constants.ts";

export interface SharedRefLink {
	refPath: string;
	sourceFile: string;
}

export interface SkillReferencePlan {
	skill: string;
	refPaths: Set<string>;
	links: SharedRefLink[];
}

function walkMarkdownFiles(dir: string, root: string): string[] {
	const files: string[] = [];
	if (!existsSync(dir)) return files;
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		if (entry.name.startsWith(".")) continue;
		const fullPath = join(dir, entry.name);
		if (entry.isDirectory()) {
			files.push(...walkMarkdownFiles(fullPath, root));
			continue;
		}
		if (entry.name.endsWith(".md")) {
			files.push(normalizeRelPath(relative(root, fullPath)));
		}
	}
	return files;
}

function canonicalExists(root: string, refPath: string): boolean {
	return existsSync(join(root, CANONICAL_REFS_DIR, refPath));
}

/** Links still pointing at the old shared root references/ tree. */
export function findSharedRefLinks(
	content: string,
	sourceFile: string,
): SharedRefLink[] {
	const links: SharedRefLink[] = [];
	for (const match of content.matchAll(SHARED_REF_LINK_RE)) {
		const refPath = match[1];
		if (!refPath) continue;
		links.push({ refPath: normalizeRelPath(refPath), sourceFile });
	}
	return links;
}

/** Links to local references/ paths that map to canonical copies. */
function findLocalCanonicalLinks(
	root: string,
	content: string,
	sourceFile: string,
): SharedRefLink[] {
	const links: SharedRefLink[] = [];
	const localRefRe = /\((?:\.\/)?references\/([^)]+)\)/g;
	for (const match of content.matchAll(localRefRe)) {
		const refPath = normalizeRelPath(match[1] ?? "");
		if (!refPath || !canonicalExists(root, refPath)) continue;
		links.push({ refPath, sourceFile });
	}

	const inReferencesDir = /\/references\//.test(sourceFile);
	if (inReferencesDir) {
		const siblingRe = /\((?!https?:|#|\.\.\/)([a-z0-9./_-]+\.md)\)/gi;
		for (const match of content.matchAll(siblingRe)) {
			const refPath = normalizeRelPath(match[1] ?? "");
			if (!refPath || !canonicalExists(root, refPath)) continue;
			links.push({ refPath, sourceFile });
		}
	}

	return links;
}

export function discoverSkillReferencePlans(
	root: string,
): SkillReferencePlan[] {
	const index = buildSkillIndex(root);
	const plans: SkillReferencePlan[] = [];

	for (const slug of index.slugs) {
		const skillDir = join(root, slug);
		if (!existsSync(join(skillDir, "SKILL.md"))) continue;

		const refPaths = new Set<string>();
		const links: SharedRefLink[] = [];

		for (const relFile of walkMarkdownFiles(skillDir, root)) {
			const content = readFileSync(join(root, relFile), "utf8");
			if (isGeneratedReference(content)) continue;
			for (const link of findSharedRefLinks(content, relFile)) {
				refPaths.add(link.refPath);
				links.push(link);
			}
			for (const link of findLocalCanonicalLinks(root, content, relFile)) {
				refPaths.add(link.refPath);
				links.push(link);
			}
		}

		if (refPaths.size > 0) {
			plans.push({ skill: slug, refPaths, links });
		}
	}

	return plans.sort((a, b) => a.skill.localeCompare(b.skill));
}

export function canonicalRefPath(root: string, refPath: string): string {
	return normalizeRelPath(join(CANONICAL_REFS_DIR, refPath));
}

export function generatedRefPath(skill: string, refPath: string): string {
	return normalizeRelPath(join(skill, "references", refPath));
}

export function rewriteSharedRefTarget(
	sourceFile: string,
	skill: string,
	refPath: string,
): string {
	const sourceDir = sourceFile.slice(0, sourceFile.lastIndexOf("/"));
	const target = generatedRefPath(skill, refPath);
	if (!sourceDir) return target;
	const fromParts = sourceDir.split("/");
	const toParts = target.split("/");
	let i = 0;
	while (
		i < fromParts.length &&
		i < toParts.length &&
		fromParts[i] === toParts[i]
	) {
		i++;
	}
	const ups = fromParts.length - i;
	const down = toParts.slice(i);
	const rel = [...Array(ups).fill(".."), ...down].join("/");
	return rel || (toParts.at(-1) ?? refPath);
}

export function rewriteSharedRefLinks(
	content: string,
	sourceFile: string,
	skill: string,
): string {
	return content.replace(SHARED_REF_LINK_RE, (_match, refPath: string) => {
		const rewritten = rewriteSharedRefTarget(
			sourceFile,
			skill,
			normalizeRelPath(refPath),
		);
		return `(${rewritten})`;
	});
}
