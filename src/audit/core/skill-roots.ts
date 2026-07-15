import { existsSync, readdirSync, readlinkSync, realpathSync } from "node:fs";
import { join, relative } from "node:path";
import { globSync } from "tinyglobby";
import type { SkillOwnershipConfig } from "../config/types.ts";
import { normalizeRelPath } from "./shared.ts";
import {
	DEFAULT_SKILLS_LOCKFILE,
	loadSkillsLock,
	resolveOwnershipForSlugs,
	type SkillProvenanceMap,
} from "./skill-provenance.ts";

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
	/** All discovered skill slugs (owned + foreign) — used for link resolution. */
	slugs: string[];
	/**
	 * Slugs that exist as flat trees (`<slug>/SKILL.md` at repo root).
	 * Flat path matching must use this set — never the union `slugs` — so a
	 * nested-only foreign slug cannot poison top-level dirs with the same name.
	 */
	flatSlugs: string[];
	/** Skill slugs whose bodies this repo owns and should lint. */
	ownedSlugs: string[];
	/** Synced / lockfile foreign skills — skipped for body lint. */
	foreignSlugs: string[];
	provenance: SkillProvenanceMap;
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
				entry.isDirectory() && !entry.name.startsWith(".") && !NESTED_EXCLUDED_DIRS.has(entry.name),
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

export function buildSkillIndex(root: string, ownership?: SkillOwnershipConfig): SkillIndex {
	const roots = detectSkillRoots(root);
	const slugSet = new Set<string>();
	const slugs: string[] = [];
	const flatSlugs = listFlatSlugs(root);

	for (const skillRoot of roots) {
		const rootSlugs =
			skillRoot.kind === "nested" ? listNestedSlugs(root, skillRoot.relPath) : flatSlugs;
		for (const slug of rootSlugs) {
			if (!slugSet.has(slug)) {
				slugSet.add(slug);
				slugs.push(slug);
			}
		}
	}

	const lockfileRel = ownership?.lockfile ?? DEFAULT_SKILLS_LOCKFILE;
	const provenance = loadSkillsLock(root, lockfileRel);
	const { ownedSlugs, foreignSlugs } = resolveOwnershipForSlugs(slugs, provenance, ownership);

	return { roots, slugs, flatSlugs, ownedSlugs, foreignSlugs, provenance };
}

export function isOwnedSkillSlug(index: SkillIndex, slug: string): boolean {
	return index.ownedSlugs.includes(slug);
}

export function isForeignSkillSlug(index: SkillIndex, slug: string): boolean {
	return index.foreignSlugs.includes(slug);
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
	return skillSlugForPath(relPath, index) !== null;
}

/**
 * Resolve the owning skill slug for a path that lives inside a detected skill
 * tree. Covers every file under the tree (SKILL.md, references/**, and any other
 * markdown), not just SKILL.md/references — so foreign classification is complete
 * for flat layouts. Returns null for non-skill paths and slug collisions
 * (e.g. `docs/<slug>/...` when `docs` is not a skill root, or top-level
 * `<nested-only-slug>/...` when that slug only exists under `.claude/skills`).
 */
export function skillSlugForPath(relPath: string, index: SkillIndex): string | null {
	const normalized = normalizeRelPath(relPath);
	const flat = new Set(index.flatSlugs);
	for (const skillRoot of index.roots) {
		if (skillRoot.kind === "nested") {
			const prefix = `${skillRoot.relPath}/`;
			if (!normalized.startsWith(prefix)) continue;
			const slug = normalized.slice(prefix.length).split("/")[0];
			if (slug && index.slugs.includes(slug)) return slug;
			continue;
		}
		const first = normalized.split("/")[0];
		// Flat membership only — nested-only slugs must not claim top-level dirs.
		if (first && flat.has(first)) return first;
	}
	return null;
}

/** True when path is under a skill tree classified foreign for body lint. */
export function isForeignSkillPath(relPath: string, index: SkillIndex): boolean {
	// Resolve the slug via real skill-root membership so docs/<foreign-slug>/**
	// (and similar collisions) are not dropped, while every file under a foreign
	// tree — not only SKILL.md/references — is classified foreign.
	const slug = skillSlugForPath(relPath, index);
	if (!slug) return false;
	return isForeignSkillSlug(index, slug);
}

const NESTED_SKILL_SLUG_RE = /(?:^|\/)\.(?:claude|agents)\/skills\/([a-z0-9-]+)\//;
const FLAT_SKILL_REFERENCES_RE = /(?:^|\/)([a-z0-9-]+)\/references(?:\/|$)/;

export function slugFromSkillPath(relPath: string): string | null {
	const normalized = normalizeRelPath(relPath);
	const nested = normalized.match(NESTED_SKILL_SLUG_RE);
	if (nested?.[1]) return nested[1];
	if (normalized.endsWith("/SKILL.md")) {
		const parts = normalized.split("/");
		return parts.at(-2) ?? null;
	}
	return null;
}

/**
 * Resolve a skill slug from a read path.
 * Covers `…/SKILL.md`, nested `.claude|agents/skills/<slug>/**`, and flat
 * `<slug>/references/**` (optionally verified via workspaceRoot + SKILL.md).
 */
export function slugFromPath(filePath: string, workspaceRoot?: string): string | null {
	const normalized = normalizeRelPath(filePath);

	const nested = normalized.match(NESTED_SKILL_SLUG_RE);
	if (nested?.[1]) return nested[1];

	if (normalized.endsWith("/SKILL.md")) {
		return slugFromSkillPath(normalized);
	}

	const flatRef = normalized.match(FLAT_SKILL_REFERENCES_RE);
	const flatSlug = flatRef?.[1];
	if (!flatSlug || FLAT_SKILL_DENYLIST.has(flatSlug)) return null;

	if (workspaceRoot) {
		if (!existsSync(join(workspaceRoot, flatSlug, "SKILL.md"))) return null;
	}

	return flatSlug;
}

export function skillCollectAugments(index: SkillIndex): string[] {
	const owned = new Set(index.ownedSlugs);
	const patterns: string[] = [];
	for (const skillRoot of index.roots) {
		if (skillRoot.kind === "nested") {
			for (const slug of index.ownedSlugs) {
				patterns.push(`${skillRoot.relPath}/${slug}/**`);
			}
		} else {
			for (const slug of index.flatSlugs) {
				if (!owned.has(slug)) continue;
				patterns.push(`${slug}/**`);
			}
		}
	}
	return patterns;
}

/**
 * Repo-relative markdown paths for owned skill trees (SKILL.md + references/**,
 * including under scan.exclude). Used by validate --base policy prove so skill-scoped
 * prose still runs against the full skill body, not just SKILL.md.
 *
 * Walks each nested root independently so the same slug under both `.claude/skills`
 * and `.agents/skills` (distinct dirs) is fully covered — not first-wins only.
 */
export function listSkillMarkdownPaths(root: string, index: SkillIndex): string[] {
	const owned = new Set(index.ownedSlugs);
	const paths = new Set<string>();
	for (const skillRoot of index.roots) {
		const slugs =
			skillRoot.kind === "nested" ? listNestedSlugs(root, skillRoot.relPath) : listFlatSlugs(root);
		for (const slug of slugs) {
			if (!owned.has(slug)) continue;
			const absDir =
				skillRoot.kind === "nested" ? join(root, skillRoot.relPath, slug) : join(root, slug);
			if (!existsSync(absDir)) continue;
			for (const abs of globSync("**/*.{md,mdc}", {
				cwd: absDir,
				absolute: true,
				onlyFiles: true,
				dot: true,
			})) {
				paths.add(normalizeRelPath(relative(root, abs)));
			}
		}
	}
	return [...paths].sort();
}

export function listSkillSlugs(index: SkillIndex): string[] {
	return index.slugs;
}

export function listOwnedSkillSlugs(index: SkillIndex): string[] {
	return index.ownedSlugs;
}
