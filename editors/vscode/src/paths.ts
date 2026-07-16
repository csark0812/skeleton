import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

const MARKDOWN_EXTENSIONS = [".md", ".mdc"];
/** Nested skill body: `.claude|agents/skills/<slug>/…` — slug must be kebab-case. */
const NESTED_SKILL_BODY_RE = /(?:^|\/)\.(?:claude|agents)\/skills\/([a-z0-9-]+)(?:\/|$)/;

/**
 * Mirror CLI `FLAT_SKILL_DENYLIST` so flat-layout routing does not treat
 * ordinary repo dirs as skill trees when they happen to contain a SKILL.md.
 * Keep in sync with `src/audit/core/skill-roots.ts`.
 */
const FLAT_SKILL_DENYLIST = new Set([
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

export function isMarkdownPath(pathOrUri: string): boolean {
	const lower = pathOrUri.toLowerCase();
	return MARKDOWN_EXTENSIONS.some((extension) => lower.endsWith(extension));
}

/**
 * Walk parents for `.skeleton/config.yaml` — same contract as CLI `findRepoRoot`.
 */
export function resolveSkeletonRoot(startDir: string): string {
	let dir = startDir;
	while (true) {
		if (existsSync(join(dir, ".skeleton", "config.yaml"))) return dir;
		const parent = dirname(dir);
		if (parent === dir) {
			throw new Error(
				"No .skeleton/config.yaml found — open a skeleton-enabled folder or run skeleton init",
			);
		}
		dir = parent;
	}
}

/**
 * Mirror CLI `isSkillPath` heuristics for editor routing (no full skill index).
 * Nested trees: `.claude|agents/skills/<slug>/**` only (not skills-root README).
 * Flat: first segment has `SKILL.md` and is not denylisted — including that
 * segment's `SKILL.md` itself (no blanket endsWith SKILL.md shortcut).
 */
export function isSkillTreePath(relPath: string, workspaceRoot: string): boolean {
	const path = relPath.replaceAll("\\", "/");
	if (NESTED_SKILL_BODY_RE.test(path)) return true;

	const first = path.split("/")[0];
	if (!first || first.startsWith(".") || FLAT_SKILL_DENYLIST.has(first)) return false;
	return existsSync(join(workspaceRoot, first, "SKILL.md"));
}

function skillSlugForEditorPath(relPath: string, skeletonRoot: string): string | null {
	const path = relPath.replaceAll("\\", "/");
	const nested = path.match(NESTED_SKILL_BODY_RE);
	if (nested?.[1]) return nested[1];

	const first = path.split("/")[0];
	if (!first || first.startsWith(".") || FLAT_SKILL_DENYLIST.has(first)) return null;
	if (!existsSync(join(skeletonRoot, first, "SKILL.md"))) return null;
	return first;
}

/**
 * Best-effort foreign skip for editor UX (CLI createContext is SSOT).
 * Treats skills-lock.json entries with non-local sourceType as foreign.
 */
export function isForeignLockedSkillPath(relPath: string, skeletonRoot: string): boolean {
	const slug = skillSlugForEditorPath(relPath, skeletonRoot);
	if (!slug) return false;

	const lockPath = join(skeletonRoot, "skills-lock.json");
	if (!existsSync(lockPath)) return false;
	try {
		const raw = JSON.parse(readFileSync(lockPath, "utf8")) as {
			skills?: Record<string, { sourceType?: string }>;
		};
		const entry = raw.skills?.[slug];
		if (!entry) return false;
		return Boolean(entry.sourceType && entry.sourceType !== "local");
	} catch {
		return false;
	}
}

export function isConfigOrRegistry(relPath: string): boolean {
	return relPath === ".skeleton/config.yaml" || relPath === ".skeleton/registry.md";
}

export function isPluginPolicy(relPath: string): boolean {
	return relPath.startsWith(".skeleton/plugins/") && /\.ya?ml$/i.test(relPath);
}

/** Paths that trigger an audit run (and may bump the generation counter). */
export function isAuditablePath(relPath: string, uriPath: string): boolean {
	return isPluginPolicy(relPath) || isConfigOrRegistry(relPath) || isMarkdownPath(uriPath);
}
