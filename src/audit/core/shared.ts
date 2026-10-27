export const CATALOG_REL_PATH = ".skeleton/catalog.md";

const EXTERNAL_LINK_RE = /^(https?:|mailto:|#)/;
export const SOURCE_OF_TRUTH_BANNER_RE = /\*\*Source of truth for\*\*/;
export const SOURCE_OF_TRUTH_BANNER_LINE_RE = /^\s*\*\*Source of truth for\*\*/m;
/** The doc-meta comment: `<!-- doc-meta: owner=eng -->`. */
export const DOC_META_RE = /<!--\s*doc-meta:\s*owner=[^|\s][^|]*?\s*-->/;

/** Replace the doc-meta comment with a fixed token, so review digests ignore metadata edits. */
export function normalizeDocMetaForReview(content: string): string {
	return content.replace(DOC_META_RE, "<!-- doc-meta -->");
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
	return !(target.includes("/") || target.includes(".") || target.startsWith("#"));
}

function escapeRegexLiteral(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Compile a path glob: `*` and `?` stay within one segment, `**` spans segments, and `**\/`
 * also matches zero directories (as tinyglobby does). `{a,b}` lists literals; `[...]` passes
 * through as a character class; every other character is literal.
 */
function globToRegex(glob: string): RegExp {
	const source = glob.replace(/\\/g, "/");
	let pattern = "";
	for (let i = 0; i < source.length; ) {
		const token = globToken(source, i);
		pattern += token.regex;
		i = token.next;
	}
	return new RegExp(`^${pattern}$`);
}

interface GlobToken {
	regex: string;
	next: number;
}

/** The regex for the glob token at `i`, and the index after it. */
function globToken(source: string, i: number): GlobToken {
	return (
		wildcardToken(source, i) ??
		groupToken(source, i) ?? {
			regex: escapeRegexLiteral(source[i] ?? ""),
			next: i + 1,
		}
	);
}

function wildcardToken(source: string, i: number): GlobToken | null {
	if (source.startsWith("**/", i)) return { regex: "(?:.*/)?", next: i + 3 };
	if (source.startsWith("**", i)) return { regex: ".*", next: i + 2 };
	if (source[i] === "*") return { regex: "[^/]*", next: i + 1 };
	if (source[i] === "?") return { regex: "[^/]", next: i + 1 };
	return null;
}

/** `{a,b}` lists literals; `[...]` passes through as a character class. */
function groupToken(source: string, i: number): GlobToken | null {
	const open = source[i];
	if (open !== "{" && open !== "[") return null;
	const close = source.indexOf(open === "{" ? "}" : "]", i);
	if (close <= i) return null;
	if (open === "[") return { regex: source.slice(i, close + 1), next: close + 1 };
	const parts = source.slice(i + 1, close).split(",");
	return {
		regex: `(${parts.map((part) => escapeRegexLiteral(part.trim())).join("|")})`,
		next: close + 1,
	};
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
