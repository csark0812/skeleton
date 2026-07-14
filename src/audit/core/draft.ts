import { normalizeRelPath } from "./shared.ts";

/** `_draft-foo.md` anywhere in the tree. */
export const DRAFT_FILENAME_RE = /(^|\/)_draft-[^/]+\.md$/i;

/** Treat configured prefixes as directories (trailing `/` implied). */
export function normalizeDraftPrefix(prefix: string): string {
	const normalized = normalizeRelPath(prefix);
	const withSlash = normalized.endsWith("/") ? normalized : `${normalized}/`;
	if (withSlash === "/" || withSlash === "./") {
		throw new Error(
			`Invalid draftPathPrefixes entry ${JSON.stringify(prefix)}: must be a repo-relative directory (e.g. drafts/), not ${JSON.stringify(prefix)}`,
		);
	}
	return withSlash;
}

/** Fail closed on prefixes that would never match repo-relative paths. */
export function validateDraftPathPrefixes(prefixes: string[] | undefined): void {
	if (!prefixes) return;
	for (const prefix of prefixes) {
		normalizeDraftPrefix(prefix);
	}
}

/**
 * Draft markers (`draft-marker` prose entry) are allowed in `_draft-*.md`
 * filenames or under any configured `draftPathPrefixes` path prefix.
 */
export function isDraftPlacementAllowed(relPath: string, draftPathPrefixes: string[]): boolean {
	const normalized = normalizeRelPath(relPath);
	if (DRAFT_FILENAME_RE.test(normalized)) return true;
	return draftPathPrefixes.some((prefix) => normalized.startsWith(normalizeDraftPrefix(prefix)));
}
