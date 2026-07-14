import { existsSync, realpathSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";

export function skeletonDir(root: string): string {
	return join(root, ".skeleton");
}

/** Map `foo.ts` → `foo.mjs` (same directory/basename). */
export function mjsPathForTs(tsPath: string): string {
	if (tsPath.endsWith(".mjs")) return tsPath;
	if (tsPath.endsWith(".ts")) return `${tsPath.slice(0, -3)}.mjs`;
	return `${tsPath}.mjs`;
}

function underBase(pathAbs: string, baseAbs: string): boolean {
	return pathAbs !== baseAbs && pathAbs.startsWith(baseAbs + sep);
}

/** Paths must be strictly under base (equality with base is rejected). */
function assertUnderBase(abs: string, base: string, label: string): void {
	const baseAbs = resolve(base);
	const pathAbs = resolve(abs);
	if (!underBase(pathAbs, baseAbs)) {
		throw new Error(`${label} must stay under .skeleton/: ${abs}`);
	}
}

/**
 * Refuse symlink escapes: lexical path under `.skeleton/` is not enough when a
 * parent directory is a symlink pointing outside (e.g. build-plugin --outfile).
 * Walks ancestors so missing nested dirs under a symlink cannot fail open.
 */
function assertRealUnderBase(abs: string, baseReal: string, label: string): void {
	const pathAbs = resolve(abs);
	let cursor = pathAbs;
	while (true) {
		if (existsSync(cursor)) {
			const real = realpathSync(cursor);
			if (real !== baseReal && !underBase(real, baseReal)) {
				throw new Error(`${label} must stay under .skeleton/: ${abs}`);
			}
			return;
		}
		const parent = dirname(cursor);
		if (parent === cursor) {
			throw new Error(`${label} must stay under .skeleton/: ${abs}`);
		}
		cursor = parent;
	}
}

function skeletonRealPath(root: string): string {
	const base = resolve(skeletonDir(root));
	return existsSync(base) ? realpathSync(base) : base;
}

/**
 * Resolve a plugin entry relative to `.skeleton/`.
 * Rejects absolute paths, `..` escapes, and entries that resolve to `.skeleton/` itself.
 */
export function resolvePluginTsPath(root: string, entry: string): string {
	if (entry.startsWith("/") || /^[A-Za-z]:[\\/]/.test(entry)) {
		throw new Error(`Plugin path must be relative to .skeleton/: ${entry}`);
	}
	const cleaned = entry.replace(/^\.skeleton\//, "").replace(/^\.\//, "");
	if (!cleaned || cleaned === ".") {
		throw new Error(`Plugin path must stay under .skeleton/: ${entry}`);
	}
	if (cleaned.split(/[/\\]/).includes("..")) {
		throw new Error(`Plugin path must stay under .skeleton/: ${entry}`);
	}
	const base = resolve(skeletonDir(root));
	const abs = resolve(base, cleaned);
	return assertPluginTsUnderSkeleton(root, abs, entry);
}

/**
 * Resolve an absolute CLI plugin entry. Lexical paths under `.skeleton/` are accepted
 * only when realpath (and the sibling `.mjs` output path) stay under the real `.skeleton/`.
 */
export function resolveAbsolutePluginTsPath(root: string, absEntry: string): string {
	if (!(absEntry.startsWith("/") || /^[A-Za-z]:[\\/]/.test(absEntry))) {
		throw new Error(`Expected absolute plugin path: ${absEntry}`);
	}
	const abs = resolve(absEntry);
	return assertPluginTsUnderSkeleton(root, abs, absEntry);
}

function assertPluginTsUnderSkeleton(root: string, abs: string, label: string): string {
	const base = resolve(skeletonDir(root));
	assertUnderBase(abs, base, "Plugin path");
	if (!abs.endsWith(".ts")) {
		throw new Error(`Plugin path must be a .ts file under .skeleton/: ${label}`);
	}
	const mjsAbs = mjsPathForTs(abs);
	assertUnderBase(mjsAbs, base, "Plugin output");
	const baseReal = skeletonRealPath(root);
	assertRealUnderBase(abs, baseReal, "Plugin path");
	assertRealUnderBase(mjsAbs, baseReal, "Plugin output");
	return abs;
}

/** Ensure an absolute path resolved from a policy glob stays under `.skeleton/`. */
export function assertUnderSkeleton(root: string, absPath: string): void {
	const base = resolve(skeletonDir(root));
	assertUnderBase(absPath, base, "Policy file");
	assertRealUnderBase(absPath, skeletonRealPath(root), "Policy file");
}
