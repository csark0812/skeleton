import { existsSync } from "node:fs";
import { join } from "node:path";

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
