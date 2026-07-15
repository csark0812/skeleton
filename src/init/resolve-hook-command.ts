import { existsSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, relative, resolve } from "node:path";
import { resolvePackageRoot } from "./package-paths.ts";

const PACKAGE_NAME = "@csark0812/skeleton";
const CLI_DIST = "dist/cli.js";
const PACKAGE_ROOT = resolvePackageRoot();

/** Dev command inside this package (mirrors package scripts). */
const DEV_HOOK_COMMAND = "bun src/cli.ts hook customize";

/** Fallback when the package is not yet installed under cwd. */
const FALLBACK_HOOK_COMMAND = `node node_modules/${PACKAGE_NAME}/${CLI_DIST} hook customize`;

function safeRealpath(path: string): string {
	try {
		return realpathSync(path);
	} catch {
		return path;
	}
}

export function toRepoRelative(cwd: string, absPath: string): string {
	// realpath both sides so macOS /var → /private/var does not force an absolute path.
	const rel = relative(safeRealpath(cwd), safeRealpath(absPath)).replace(/\\/g, "/");
	return rel.startsWith("..") ? absPath.replace(/\\/g, "/") : rel;
}

function tryResolvePublishedCli(cwd: string): string | null {
	try {
		const req = createRequire(join(cwd, "package.json"));
		return req.resolve(`${PACKAGE_NAME}/${CLI_DIST}`);
	} catch {
		return null;
	}
}

function walkNodeModulesCli(cwd: string): string | null {
	let dir = cwd;
	while (true) {
		const candidate = join(dir, "node_modules", PACKAGE_NAME, CLI_DIST);
		if (existsSync(candidate)) return candidate;
		const parent = dirname(dir);
		if (parent === dir) break;
		dir = parent;
	}
	return null;
}

function isInsidePackageRoot(cwd: string): boolean {
	const rel = relative(PACKAGE_ROOT, resolve(cwd)).replace(/\\/g, "/");
	return rel === "" || (!rel.startsWith("..") && !rel.startsWith("/"));
}

function nodeCliHookCommand(cliPath: string): string {
	return `node ${cliPath} hook customize`;
}

/**
 * Resolve the customize-hook command for `skeleton init`.
 * Prefer a cwd-local `node …/dist/cli.js hook customize` so IDE runners that
 * lack `node_modules/.bin` on PATH still work after a local install.
 */
export function resolveHookCommand(cwd: string): string {
	if (isInsidePackageRoot(cwd)) return DEV_HOOK_COMMAND;

	const published = tryResolvePublishedCli(cwd);
	if (published) return nodeCliHookCommand(toRepoRelative(cwd, published));

	const hoisted = walkNodeModulesCli(cwd);
	if (hoisted) return nodeCliHookCommand(toRepoRelative(cwd, hoisted));

	return FALLBACK_HOOK_COMMAND;
}

export function isSkeletonHookCommand(command: string | undefined): boolean {
	if (!command) return false;
	// New CLI form (`… hook customize`, including bare `skeleton hook customize`)…
	if (/\bhook\s+customize\b/.test(command)) return true;
	// …and the legacy standalone entrypoint, so re-init upgrades it in place.
	return /customize-on-skill-read\.(js|ts)\b/.test(command);
}
