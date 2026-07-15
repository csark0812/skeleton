import { existsSync } from "node:fs";
import { join } from "node:path";

const MARKDOWN_EXTENSIONS = [".md", ".mdc"];
const NESTED_SKILL_RE = /(?:^|\/)\.(?:claude|agents)\/skills\//;
const FLAT_SKILL_REFERENCES_RE = /^([a-z0-9-]+)\/references(?:\/|$)/;

export function isMarkdownPath(pathOrUri: string): boolean {
	const lower = pathOrUri.toLowerCase();
	return MARKDOWN_EXTENSIONS.some((extension) => lower.endsWith(extension));
}

/** Mirror CLI `isSkillPath` heuristics for editor routing (no config load). */
export function isSkillTreePath(relPath: string, workspaceRoot: string): boolean {
	const path = relPath.replaceAll("\\", "/");
	if (path === "SKILL.md" || path.endsWith("/SKILL.md")) return true;
	if (NESTED_SKILL_RE.test(path)) return true;
	const flat = path.match(FLAT_SKILL_REFERENCES_RE);
	const slug = flat?.[1];
	if (!slug) return false;
	return existsSync(join(workspaceRoot, slug, "SKILL.md"));
}

export function isConfigOrRegistry(relPath: string): boolean {
	return relPath === ".skeleton/config.yaml" || relPath === ".skeleton/registry.md";
}

export function isPluginPolicy(relPath: string): boolean {
	return relPath.startsWith(".skeleton/plugins/") && /\.ya?ml$/i.test(relPath);
}
