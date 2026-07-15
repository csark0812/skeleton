import { relative, resolve } from "node:path";
import { resolvePackageRoot } from "./package-paths.ts";

const PACKAGE_ROOT = resolvePackageRoot();

/** Command consumers run: the published `skeleton` bin exposes `hook customize`. */
const PUBLISHED_HOOK_COMMAND = "skeleton hook customize";
/** Command inside this repo (dev): mirror the `bun src/cli.ts …` package scripts. */
const DEV_HOOK_COMMAND = "bun src/cli.ts hook customize";

function isInsidePackageRoot(cwd: string): boolean {
	const rel = relative(PACKAGE_ROOT, resolve(cwd)).replace(/\\/g, "/");
	return rel === "" || (!rel.startsWith("..") && !rel.startsWith("/"));
}

export function resolveHookCommand(cwd: string): string {
	// Working inside the skeleton package itself (no published bin on PATH):
	// run the CLI straight from source, like the repo's own package scripts.
	if (isInsidePackageRoot(cwd)) return DEV_HOOK_COMMAND;
	return PUBLISHED_HOOK_COMMAND;
}

export function isSkeletonHookCommand(command: string | undefined): boolean {
	if (!command) return false;
	// New CLI form (`skeleton hook customize`, `bun src/cli.ts hook customize`)…
	if (/\bhook\s+customize\b/.test(command)) return true;
	// …and the legacy standalone entrypoint, so re-init upgrades it in place.
	return /customize-on-skill-read\.(js|ts)\b/.test(command);
}
