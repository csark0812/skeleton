import { normalizeRelPath } from "./shared.ts";

/** `_draft-foo.md` anywhere in the tree. */
export const DRAFT_FILENAME_RE = /(^|\/)_draft-[^/]+\.md$/i;

/**
 * Draft markers (`draft-marker` prose entry) are allowed in `_draft-*.md`
 * filenames or under any configured `draftPathPrefixes` path prefix.
 */
export function isDraftPlacementAllowed(relPath: string, draftPathPrefixes: string[]): boolean {
	const normalized = normalizeRelPath(relPath);
	if (DRAFT_FILENAME_RE.test(normalized)) return true;
	return draftPathPrefixes.some((prefix) => normalized.startsWith(prefix));
}
