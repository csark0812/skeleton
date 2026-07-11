import { existsSync, readdirSync, readlinkSync, realpathSync } from "node:fs";
import { join, relative } from "node:path";
import { normalizeRelPath } from "./shared.ts";

export const NESTED_SKILL_ROOTS = [".claude/skills", ".agents/skills"] as const;

/** Directories at repo root that must not be treated as flat skill slugs. */
export const FLAT_SKILL_DENYLIST = new Set([
	".git",
	".github",
	".skeleton",
	".cursor",
	".claude",
	".agents",
	".codex",
	"docs",
	"refs",
	"scripts",
	"src",
	"dist",
	"node_modules",
	"templates",
	"fixtures",
	"schemas",
]);

export type SkillRootKind = "nested" | "flat";

export interface SkillRoot {
	kind: SkillRootKind;
	relPath: string;
}

export interface SkillIndex {
	roots: SkillRoot[];
	slugs: string[];
}

const NESTED_EXCLUDED_DIRS = new Set(["references", "_shared"]);

function safeRealpath(path: string): string | null {
	try {
		return realpathSync(path);
	} catch {
		return null;
	}
}

function listNestedSlugs(root: string, relRoot: string): string[] {
	const absRoot = join(root, relRoot);
	if (!existsSync(absRoot)) return [];
	return readdirSync(absRoot, { withFileTypes: true })
		.filter(
			(entry) =>
				entry.isDirectory() &&
				!entry.name.startsWith(".") &&
				!NESTED_EXCLUDED_DIRS.has(entry.name),
		)
		.filter((entry) => existsSync(join(absRoot, entry.name, "SKILL.md")))
		.map((entry) => entry.name)
		.sort();
}

function listFlatSlugs(root: string): string[] {
	const slugs: string[] = [];
	for (const entry of readdirSync(root, { withFileTypes: true })) {
		if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
		if (FLAT_SKILL_DENYLIST.has(entry.name)) continue;
		if (existsSync(join(root, entry.name, "SKILL.md"))) {
			slugs.push(entry.name);
		}
	}
	return slugs.sort();
}

export function detectSkillRoots(root: string): SkillRoot[] {
	const roots: SkillRoot[] = [];
	let claudeReal: string | null = null;

	for (const relRoot of NESTED_SKILL_ROOTS) {
		const abs = join(root, relRoot);
		if (!existsSync(abs)) continue;

		if (relRoot === ".claude/skills") {
			claudeReal = safeRealpath(abs);
		}
		if (relRoot === ".agents/skills" && claudeReal) {
			const agentsReal = safeRealpath(abs);
			if (agentsReal && agentsReal === claudeReal) continue;
			const linkTarget = safeRealpath(abs);
			if (linkTarget === claudeReal) continue;
			try {
				const link = readlinkSync(abs);
				if (link && claudeReal && safeRealpath(join(root, link)) === claudeReal) continue;
			} catch {
				// not a symlink
			}
		}

		if (listNestedSlugs(root, relRoot).length > 0 || existsSync(abs)) {
			roots.push({ kind: "nested", relPath: relRoot });
		}
	}

	const flatSlugs = listFlatSlugs(root);
	if (flatSlugs.length > 0) {
		roots.push({ kind: "flat", relPath: "." });
	}

	return roots;
}

export function buildSkillIndex(root: string): SkillIndex {
	const roots = detectSkillRoots(root);
	const slugSet = new Set<string>();
	const slugs: string[] = [];

	for (const skillRoot of roots) {
		const rootSlugs =
			skillRoot.kind === "nested"
				? listNestedSlugs(root, skillRoot.relPath)
				: listFlatSlugs(root);
		for (const slug of rootSlugs) {
			if (!slugSet.has(slug)) {
				slugSet.add(slug);
				slugs.push(slug);
			}
		}
	}

	return { roots, slugs };
}

export function resolveSkillPath(index: SkillIndex, root: string, slug: string): string | null {
	for (const skillRoot of index.roots) {
		const candidate =
			skillRoot.kind === "nested"
				? join(root, skillRoot.relPath, slug, "SKILL.md")
				: join(root, slug, "SKILL.md");
		if (existsSync(candidate)) {
			return normalizeRelPath(relative(root, candidate));
		}
	}
	return null;
}

export function isSkillPath(relPath: string, index: SkillIndex): boolean {
	const normalized = normalizeRelPath(relPath);
	if (normalized.endsWith("/SKILL.md")) return true;
	for (const skillRoot of index.roots) {
		const prefix = skillRoot.kind === "nested" ? `${skillRoot.relPath}/` : "";
		if (prefix && normalized.startsWith(prefix)) return true;
		if (skillRoot.kind === "flat") {
			const first = normalized.split("/")[0];
			if (first && index.slugs.includes(first)) return true;
		}
	}
	return false;
}

export function slugFromSkillPath(relPath: string): string | null {
	const normalized = normalizeRelPath(relPath);
	if (normalized.endsWith("/SKILL.md")) {
		const parts = normalized.split("/");
		return parts.at(-2) ?? null;
	}
	return null;
}

export function slugFromPath(filePath: string): string | null {
	const normalized = normalizeRelPath(filePath);
	if (!normalized.endsWith("/SKILL.md")) return null;
	return slugFromSkillPath(normalized);
}

export function skillCollectAugments(index: SkillIndex): string[] {
	const patterns: string[] = [];
	for (const skillRoot of index.roots) {
		if (skillRoot.kind === "nested") {
			patterns.push(`${skillRoot.relPath}/**`);
		} else {
			for (const slug of index.slugs) {
				patterns.push(`${slug}/**`);
			}
		}
	}
	return patterns;
}

export function listSkillSlugs(index: SkillIndex): string[] {
	return index.slugs;
}
