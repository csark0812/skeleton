import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
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

/** Parse `build-plugin` argv after the command name. Fail closed on unknown flags. */
export function parseBuildPluginArgs(argv: string[]): { entry?: string; check: boolean } {
	let check = false;
	let entry: string | undefined;
	for (const arg of argv) {
		if (arg === "--check") {
			check = true;
		} else if (arg.startsWith("--check=")) {
			throw new Error("build-plugin: use --check (boolean flag), not --check=<value>");
		} else if (arg.startsWith("-")) {
			throw new Error(`build-plugin: unknown flag ${arg}`);
		} else if (!entry) {
			entry = arg;
		}
	}
	return { entry, check };
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

/**
 * Resolve local relative imports for stale-check (incl. `./x.js` → `x.ts`).
 * Covers `from "…"`, side-effect `import "…"`, and dynamic `import("…")`.
 */
export function localImportPaths(tsAbs: string, content: string): string[] {
	const dir = dirname(tsAbs);
	const deps: string[] = [];
	const re = /(?:from\s+|import\s*\(\s*|import\s+)["'](\.[^"']+)["']/g;
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

/** Sidecar next to `.mjs` recording the source graph fingerprint from last build. */
export function stampPathForMjs(mjsAbs: string): string {
	return `${mjsAbs}.stamp`;
}

/**
 * Content fingerprint of the plugin entry and transitive local `.ts` imports.
 * Bun-free; used by `--check` so equal-mtime / post-checkout content drift still fails.
 */
export function sourceFingerprint(tsAbs: string, seen = new Set<string>()): string {
	const hash = createHash("sha256");
	function walk(abs: string): void {
		if (seen.has(abs)) return;
		seen.add(abs);
		const content = readFileSync(abs, "utf8");
		hash.update(basename(abs));
		hash.update("\0");
		hash.update(content);
		hash.update("\0");
		for (const dep of localImportPaths(abs, content).sort()) {
			walk(dep);
		}
	}
	walk(tsAbs);
	return hash.digest("hex");
}

function writeStamp(tsAbs: string, mjsAbs: string): void {
	writeFileSync(stampPathForMjs(mjsAbs), `${sourceFingerprint(tsAbs)}\n`, "utf8");
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
	writeStamp(tsAbs, mjsAbs);
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
	const stampAbs = stampPathForMjs(mjsAbs);
	if (!existsSync(stampAbs)) {
		throw new Error(`Plugin stale: ${mjsAbs} has no fingerprint stamp. Run: skeleton build-plugin`);
	}
	const expected = readFileSync(stampAbs, "utf8").trim();
	const actual = sourceFingerprint(tsAbs);
	if (expected !== actual) {
		throw new Error(
			`Plugin stale: ${mjsAbs} does not match ${tsAbs} (or local imports). Run: skeleton build-plugin`,
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
