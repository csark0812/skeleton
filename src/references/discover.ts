import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import type { SkillOwnershipConfig } from "../audit/config/types.ts";
import { normalizeRelPath } from "../audit/core/shared.ts";
import { buildSkillIndex } from "../audit/core/skill-roots.ts";
import { CANONICAL_REFS_DIR, isGeneratedReference, SHARED_REF_LINK_RE } from "./constants.ts";

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
export function findSharedRefLinks(content: string, sourceFile: string): SharedRefLink[] {
	const links: SharedRefLink[] = [];
	for (const match of content.matchAll(SHARED_REF_LINK_RE)) {
		const refPath = match[1];
		if (!refPath) continue;
		links.push({ refPath: normalizeRelPath(refPath), sourceFile });
	}
	return links;
}

function findSiblingRefLinks(root: string, content: string, sourceFile: string): SharedRefLink[] {
	const links: SharedRefLink[] = [];
	if (!/\/references\//.test(sourceFile)) return links;

	const refsIdx = sourceFile.lastIndexOf("/references/");
	const withinRefs = sourceFile.slice(refsIdx + "/references/".length);
	const withinDir = withinRefs.includes("/")
		? withinRefs.slice(0, withinRefs.lastIndexOf("/"))
		: "";
	const siblingRe = /\((?!https?:|#|\.\.\/)([a-z0-9./_-]+\.md)\)/gi;
	for (const match of content.matchAll(siblingRe)) {
		const raw = normalizeRelPath(match[1] ?? "");
		if (!raw) continue;
		const refPath = withinDir ? normalizeRelPath(join(withinDir, raw)) : raw;
		if (!canonicalExists(root, refPath)) continue;
		links.push({ refPath, sourceFile });
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
		if (!(refPath && canonicalExists(root, refPath))) continue;
		links.push({ refPath, sourceFile });
	}
	links.push(...findSiblingRefLinks(root, content, sourceFile));
	return links;
}

function collectLinksForFile(root: string, relFile: string): SharedRefLink[] {
	const content = readFileSync(join(root, relFile), "utf8");
	if (isGeneratedReference(content)) return [];
	return [
		...findSharedRefLinks(content, relFile),
		...findLocalCanonicalLinks(root, content, relFile),
	];
}

interface TransitiveRefInput {
	root: string;
	slug: string;
	refPaths: Set<string>;
	links: SharedRefLink[];
}

function expandTransitiveRefs(input: TransitiveRefInput): void {
	const { root, slug, refPaths, links } = input;
	const queue = [...refPaths];
	while (queue.length > 0) {
		const refPath = queue.pop();
		if (!(refPath && canonicalExists(root, refPath))) continue;
		const canonicalContent = readFileSync(join(root, CANONICAL_REFS_DIR, refPath), "utf8");
		const syntheticSource = generatedRefPath(slug, refPath);
		for (const link of findLocalCanonicalLinks(root, canonicalContent, syntheticSource)) {
			if (refPaths.has(link.refPath)) continue;
			refPaths.add(link.refPath);
			links.push(link);
			queue.push(link.refPath);
		}
	}
}

function planForSkill(root: string, slug: string): SkillReferencePlan | null {
	const skillDir = join(root, slug);
	if (!existsSync(join(skillDir, "SKILL.md"))) return null;

	const refPaths = new Set<string>();
	const links: SharedRefLink[] = [];
	for (const relFile of walkMarkdownFiles(skillDir, root)) {
		for (const link of collectLinksForFile(root, relFile)) {
			refPaths.add(link.refPath);
			links.push(link);
		}
	}
	expandTransitiveRefs({ root, slug, refPaths, links });
	return refPaths.size > 0 ? { skill: slug, refPaths, links } : null;
}

export function discoverSkillReferencePlans(
	root: string,
	ownership?: SkillOwnershipConfig,
): SkillReferencePlan[] {
	const index = buildSkillIndex(root, ownership);
	const plans: SkillReferencePlan[] = [];

	for (const slug of index.ownedSlugs) {
		const plan = planForSkill(root, slug);
		if (plan) plans.push(plan);
	}

	return plans.sort((a, b) => a.skill.localeCompare(b.skill));
}

export function canonicalRefPath(_root: string, refPath: string): string {
	return normalizeRelPath(join(CANONICAL_REFS_DIR, refPath));
}

export function generatedRefPath(skill: string, refPath: string): string {
	return normalizeRelPath(join(skill, "references", refPath));
}

export function rewriteSharedRefTarget(sourceFile: string, skill: string, refPath: string): string {
	const sourceDir = sourceFile.slice(0, sourceFile.lastIndexOf("/"));
	const target = generatedRefPath(skill, refPath);
	if (!sourceDir) return target;
	const fromParts = sourceDir.split("/");
	const toParts = target.split("/");
	let i = 0;
	while (i < fromParts.length && i < toParts.length && fromParts[i] === toParts[i]) {
		i++;
	}
	const ups = fromParts.length - i;
	const down = toParts.slice(i);
	const rel = [...Array(ups).fill(".."), ...down].join("/");
	return rel || (toParts.at(-1) ?? refPath);
}

export function rewriteSharedRefLinks(content: string, sourceFile: string, skill: string): string {
	return content.replace(SHARED_REF_LINK_RE, (_match, refPath: string) => {
		const rewritten = rewriteSharedRefTarget(sourceFile, skill, normalizeRelPath(refPath));
		return `(${rewritten})`;
	});
}
