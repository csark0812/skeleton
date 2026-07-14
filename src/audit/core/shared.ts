import { join, relative, resolve } from "node:path";

export const REGISTRY_REL_PATH = ".skeleton/registry.md";
export const REGISTRY_DIR_REL = ".skeleton";

export const EXTERNAL_LINK_RE = /^(https?:|mailto:|#)/;
export const SOURCE_OF_TRUTH_BANNER_RE = /\*\*Source of truth for\*\*/;
export const SOURCE_OF_TRUTH_BANNER_LINE_RE = /^\s*\*\*Source of truth for\*\*/m;
export const DOC_META_RE =
	/<!--\s*doc-meta:\s*owner=[^|]+\|\s*last-reviewed=\d{4}-\d{2}-\d{2}\s*-->/;
export const DOC_META_LAST_REVIEWED_RE = /last-reviewed=(\d{4}-\d{2}-\d{2})/;

/** Extract last-reviewed date from the doc-meta comment only (ignore prose examples). */
export function docMetaLastReviewed(content: string): string | null {
	const meta = DOC_META_RE.exec(content);
	if (!meta?.[0]) return null;
	const match = DOC_META_LAST_REVIEWED_RE.exec(meta[0]);
	return match?.[1] ?? null;
}

/** Replace last-reviewed inside the doc-meta comment only. Returns null if unchanged/missing. */
export function replaceDocMetaLastReviewed(content: string, date: string): string | null {
	const meta = DOC_META_RE.exec(content);
	if (!meta?.[0] || meta.index === undefined) return null;
	const updatedComment = meta[0].replace(DOC_META_LAST_REVIEWED_RE, `last-reviewed=${date}`);
	if (updatedComment === meta[0]) return null;
	return content.slice(0, meta.index) + updatedComment + content.slice(meta.index + meta[0].length);
}
export const SKILL_LINK_IN_TARGET_RE =
	/(?:\.claude\/skills\/|\.agents\/skills\/|(?:\.\.\/)+)([a-z0-9-]+)\/SKILL\.md/;
export const SKILL_LINK_RE =
	/(?:\.claude\/skills\/|\.agents\/skills\/|\.\.\/|\.\/)?([a-z0-9-]+)\/SKILL\.md/g;

/**
 * Normalize repo-relative paths for bucket / filter matching.
 * Converts backslashes and strips leading `./` segments. Absolute paths are left as-is
 * (callers that accept only repo-relative paths must reject or remap them separately).
 */
export function normalizeRelPath(p: string): string {
	let out = p.replace(/\\/g, "/");
	if (out.startsWith("/")) return out;
	while (out.startsWith("./")) {
		out = out.slice(2);
	}
	return out;
}

export function isExternalLink(target: string): boolean {
	return EXTERNAL_LINK_RE.test(target);
}

export function isPlaceholderLink(target: string): boolean {
	return !target.includes("/") && !target.includes(".") && !target.startsWith("#");
}

function escapeRegexLiteral(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function globToRegex(glob: string): RegExp {
	let pattern = glob.replace(/\\/g, "/");
	pattern = pattern.replace(/\{([^}]+)\}/g, (_, inner: string) => {
		const parts = inner.split(",").map((p) => escapeRegexLiteral(p.trim()));
		return `(${parts.join("|")})`;
	});
	pattern = pattern
		.replace(/\*\*/g, "§§")
		.replace(/\*/g, "[^/]*")
		.replace(/§§/g, ".*")
		.replace(/\?/g, "[^/]");
	return new RegExp(`^${pattern}$`);
}

export function matchesGlobScope(relPath: string, scope: string | undefined): boolean {
	if (!scope) return true;
	return globToRegex(scope).test(normalizeRelPath(relPath));
}

export function extractScanRootsFromInclude(include: string[]): string[] {
	const roots = new Set<string>();
	for (const pattern of include) {
		const normalized = normalizeRelPath(pattern);
		const globIdx = normalized.search(/[*?[{]/);
		if (globIdx === -1) {
			if (/\.[a-z0-9]+$/i.test(normalized)) continue;
			roots.add(normalized.replace(/\/$/, ""));
			continue;
		}
		const root = normalized.slice(0, globIdx).replace(/\/$/, "");
		if (root) roots.add(root);
	}
	return [...roots];
}

export function resolveFromRegistry(root: string, linkTarget: string): string {
	const resolved = resolve(join(root, REGISTRY_DIR_REL), linkTarget);
	return normalizeRelPath(relative(root, resolved));
}
