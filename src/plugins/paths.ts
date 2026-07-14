import { join, resolve, sep } from "node:path";

export function skeletonDir(root: string): string {
	return join(root, ".skeleton");
}

/** Map `foo.ts` → `foo.mjs` (same directory/basename). */
export function mjsPathForTs(tsPath: string): string {
	if (tsPath.endsWith(".mjs")) return tsPath;
	if (tsPath.endsWith(".ts")) return `${tsPath.slice(0, -3)}.mjs`;
	return `${tsPath}.mjs`;
}

function assertUnderBase(abs: string, base: string, label: string): void {
	const baseAbs = resolve(base);
	const pathAbs = resolve(abs);
	if (pathAbs !== baseAbs && !pathAbs.startsWith(baseAbs + sep)) {
		throw new Error(`${label} must stay under .skeleton/: ${abs}`);
	}
}

/**
 * Resolve a plugin entry relative to `.skeleton/`.
 * Rejects absolute paths and `..` escapes.
 */
export function resolvePluginTsPath(root: string, entry: string): string {
	if (entry.startsWith("/") || /^[A-Za-z]:[\\/]/.test(entry)) {
		throw new Error(`Plugin path must be relative to .skeleton/: ${entry}`);
	}
	const cleaned = entry.replace(/^\.skeleton\//, "");
	if (cleaned.split(/[/\\]/).includes("..")) {
		throw new Error(`Plugin path must stay under .skeleton/: ${entry}`);
	}
	const base = resolve(skeletonDir(root));
	const abs = resolve(base, cleaned);
	assertUnderBase(abs, base, "Plugin path");
	return abs;
}

/** Ensure an absolute path resolved from a policy glob stays under `.skeleton/`. */
export function assertUnderSkeleton(root: string, absPath: string): void {
	assertUnderBase(absPath, skeletonDir(root), "Policy file");
}
