import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, extname, isAbsolute, join } from "node:path";

const PACKAGE_NAME = "@csark0812/skeleton";
const CLI_DIST = "dist/cli.js";
const JS_EXTENSIONS = new Set([".js", ".mjs", ".cjs"]);

export interface ResolvedCommand {
	executable: string;
	prefixArgs: string[];
}

function tryResolvePublishedCli(root: string): string | null {
	try {
		const req = createRequire(join(root, "package.json"));
		return req.resolve(`${PACKAGE_NAME}/${CLI_DIST}`);
	} catch {
		return null;
	}
}

function walkNodeModulesCli(root: string): string | null {
	let dir = root;
	while (true) {
		const candidate = join(dir, "node_modules", PACKAGE_NAME, CLI_DIST);
		if (existsSync(candidate)) return candidate;
		const parent = dirname(dir);
		if (parent === dir) break;
		dir = parent;
	}
	return null;
}

function nodeCli(cliJs: string): ResolvedCommand {
	return { executable: process.execPath, prefixArgs: [cliJs] };
}

function isJavaScriptEntry(path: string): boolean {
	return JS_EXTENSIONS.has(extname(path).toLowerCase());
}

/**
 * Resolve how to spawn the Skeleton CLI without Windows `.cmd` shims.
 * Prefer `process.execPath` + `dist/cli.js` so `shell: false` works on all platforms.
 */
export function resolveSkeletonCommand(root: string, configuredPath = ""): ResolvedCommand {
	const configured = configuredPath.trim();
	if (configured) {
		if (!isAbsolute(configured)) {
			throw new Error("skeleton.path must be an absolute executable path");
		}
		if (isJavaScriptEntry(configured)) return nodeCli(configured);
		return { executable: configured, prefixArgs: [] };
	}

	const published = tryResolvePublishedCli(root);
	if (published) return nodeCli(published);

	const hoisted = walkNodeModulesCli(root);
	if (hoisted) return nodeCli(hoisted);

	throw new Error(
		`Skeleton CLI not found under ${root}. Install @csark0812/skeleton in the workspace or set skeleton.path to an absolute dist/cli.js (or binary) path.`,
	);
}
