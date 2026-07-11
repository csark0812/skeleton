import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PACKAGE_NAME = "@csark0812/skeleton";
const HOOK_DIST = "dist/hooks/customize-on-skill-read.js";
const HOOK_SRC = "src/hooks/customize-on-skill-read.ts";

const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");

export function toRepoRelative(cwd: string, absPath: string): string {
	const rel = relative(cwd, absPath).replace(/\\/g, "/");
	return rel.startsWith("..") ? absPath.replace(/\\/g, "/") : rel;
}

function tryResolvePublished(cwd: string): string | null {
	try {
		const req = createRequire(join(cwd, "package.json"));
		return req.resolve(`${PACKAGE_NAME}/${HOOK_DIST}`);
	} catch {
		return null;
	}
}

function walkNodeModules(cwd: string): string | null {
	let dir = cwd;
	while (true) {
		const candidate = join(dir, "node_modules", PACKAGE_NAME, HOOK_DIST);
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

export function resolveHookCommand(cwd: string): string {
	const published = tryResolvePublished(cwd);
	if (published) return toRepoRelative(cwd, published);

	const hoisted = walkNodeModules(cwd);
	if (hoisted) return toRepoRelative(cwd, hoisted);

	if (isInsidePackageRoot(cwd)) {
		const distHook = join(PACKAGE_ROOT, HOOK_DIST);
		if (existsSync(distHook)) return toRepoRelative(cwd, distHook);

		const srcHook = join(PACKAGE_ROOT, HOOK_SRC);
		if (existsSync(srcHook)) {
			const rel = toRepoRelative(cwd, srcHook);
			return rel.includes("/") ? `bun ${rel}` : `bun ./${rel}`;
		}
	}

	return `node node_modules/${PACKAGE_NAME}/${HOOK_DIST}`;
}

export function isSkeletonHookCommand(command: string | undefined): boolean {
	if (!command) return false;
	return /customize-on-skill-read\.(js|ts)\b/.test(command);
}
