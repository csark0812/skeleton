import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { findRepoRoot, loadConfig } from "../audit/config/load.ts";
import type { SkeletonConfig } from "../audit/config/types.ts";
import { mjsPathForTs, resolveAbsolutePluginTsPath, resolvePluginTsPath } from "./paths.ts";

export interface BuildPluginOptions {
	root?: string;
	/** Path relative to `.skeleton/` or absolute; omit to build all config.plugins */
	entry?: string;
	check?: boolean;
}

export interface BuildPluginResult {
	built: string[];
	checked: string[];
}

function collectPluginEntries(root: string, config: SkeletonConfig, entry?: string): string[] {
	if (entry) {
		const abs =
			entry.startsWith("/") || /^[A-Za-z]:[\\/]/.test(entry)
				? resolveAbsolutePluginTsPath(root, entry)
				: resolvePluginTsPath(root, entry);
		return [abs];
	}
	return (config.plugins ?? []).map((e) => resolvePluginTsPath(root, e));
}

/** Resolve local relative imports for stale-check (incl. `./x.js` → `x.ts`). */
export function localImportPaths(tsAbs: string, content: string): string[] {
	const dir = dirname(tsAbs);
	const deps: string[] = [];
	const re = /from\s+["'](\.[^"']+)["']/g;
	for (const match of content.matchAll(re)) {
		const spec = match[1];
		if (!spec) continue;
		const candidates: string[] = [];
		if (spec.endsWith(".js")) {
			const withoutJs = spec.slice(0, -".js".length);
			candidates.push(
				resolve(dir, `${withoutJs}.ts`),
				resolve(dir, spec),
				resolve(dir, withoutJs, "index.ts"),
			);
		} else {
			candidates.push(
				resolve(dir, spec),
				resolve(dir, `${spec}.ts`),
				resolve(dir, `${spec}.js`),
				resolve(dir, spec, "index.ts"),
			);
		}
		for (const candidate of candidates) {
			if (existsSync(candidate) && candidate.endsWith(".ts")) {
				deps.push(candidate);
				break;
			}
		}
	}
	return deps;
}

function latestSourceMtime(tsAbs: string, seen = new Set<string>()): number {
	if (seen.has(tsAbs)) return 0;
	seen.add(tsAbs);
	let latest = statSync(tsAbs).mtimeMs;
	const content = readFileSync(tsAbs, "utf8");
	for (const dep of localImportPaths(tsAbs, content)) {
		latest = Math.max(latest, latestSourceMtime(dep, seen));
	}
	return latest;
}

async function buildOne(tsAbs: string): Promise<string> {
	const mjsAbs = mjsPathForTs(tsAbs);
	if (!existsSync(tsAbs)) {
		throw new Error(`Plugin source not found: ${tsAbs}`);
	}

	const proc = spawnSync(
		"bun",
		["build", tsAbs, "--target=node", "--format=esm", `--outfile=${mjsAbs}`, "--packages=external"],
		{ encoding: "utf8" },
	);
	if (proc.error) {
		const code = (proc.error as NodeJS.ErrnoException).code;
		if (code === "ENOENT") {
			throw new Error(
				"skeleton build-plugin requires the bun binary on PATH (bun build). Install Bun 1.2.x.",
			);
		}
		throw new Error(`skeleton build-plugin failed to spawn bun: ${proc.error.message}`);
	}
	if (proc.status !== 0) {
		throw new Error(
			`skeleton build-plugin failed for ${tsAbs}:\n${proc.stderr || proc.stdout || `exit ${proc.status}`}`,
		);
	}
	return mjsAbs;
}

function checkOne(tsAbs: string): void {
	const mjsAbs = mjsPathForTs(tsAbs);
	if (!existsSync(mjsAbs)) {
		throw new Error(`Plugin not built: ${tsAbs} (missing ${mjsAbs}). Run: skeleton build-plugin`);
	}
	if (!existsSync(tsAbs)) {
		throw new Error(`Plugin source not found: ${tsAbs}`);
	}
	const sourceMtime = latestSourceMtime(tsAbs);
	const mjsMtime = statSync(mjsAbs).mtimeMs;
	if (mjsMtime < sourceMtime) {
		throw new Error(
			`Plugin stale: ${mjsAbs} is older than ${tsAbs} (or local imports). Run: skeleton build-plugin`,
		);
	}
}

export async function runBuildPlugin(options: BuildPluginOptions = {}): Promise<BuildPluginResult> {
	const root = options.root ?? findRepoRoot();
	const config = loadConfig(root);
	const entries = collectPluginEntries(root, config, options.entry);
	if (entries.length === 0) {
		return { built: [], checked: [] };
	}

	const built: string[] = [];
	const checked: string[] = [];

	if (options.check) {
		for (const entry of entries) {
			checkOne(entry);
			checked.push(mjsPathForTs(entry));
		}
		return { built, checked };
	}

	for (const entry of entries) {
		built.push(await buildOne(entry));
	}
	return { built, checked };
}
