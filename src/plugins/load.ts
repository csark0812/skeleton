import { existsSync, readFileSync } from "node:fs";
import { relative } from "node:path";
import { pathToFileURL } from "node:url";
import { globSync } from "tinyglobby";
import type { SkeletonConfig } from "../audit/config/types.ts";
import { loadPolicyFile } from "../audit/policies/load.ts";
import type { PolicyFile } from "../audit/policies/types.ts";
import type { AuditRule } from "../audit/rules/index.ts";
import { assertUnderSkeleton, mjsPathForTs, resolvePluginTsPath, skeletonDir } from "./paths.ts";

export interface PluginModule {
	rules: AuditRule[];
	policies?: string[];
}

export interface LoadedPlugins {
	rules: AuditRule[];
	policies: PolicyFile[];
}

export function normalizeExport(mod: unknown): PluginModule {
	const candidate =
		mod && typeof mod === "object" && "default" in mod
			? (mod as { default: unknown }).default
			: mod;
	const source =
		candidate && typeof candidate === "object"
			? (candidate as PluginModule)
			: (mod as PluginModule);

	if (!source || !Array.isArray(source.rules)) {
		throw new Error("Plugin module must export { rules: AuditRule[]; policies?: string[] }");
	}

	for (const rule of source.rules) {
		if (!rule || typeof rule.id !== "string" || typeof rule.run !== "function") {
			throw new Error("Plugin rules must each have string id and run()");
		}
	}

	if (source.policies !== undefined) {
		if (!Array.isArray(source.policies) || source.policies.some((p) => typeof p !== "string")) {
			throw new Error(
				"Plugin policies must be string[] (globs relative to .skeleton/) — got non-array",
			);
		}
	}

	return {
		rules: source.rules,
		policies: source.policies,
	};
}

function loadPoliciesFromGlobs(root: string, globs: string[]): PolicyFile[] {
	const base = skeletonDir(root);
	const files = new Set<string>();
	for (const pattern of globs) {
		if (pattern.split(/[/\\]/).includes("..")) {
			throw new Error(`Policy glob must stay under .skeleton/: ${pattern}`);
		}
		const matches = globSync(pattern, {
			cwd: base,
			absolute: true,
			onlyFiles: true,
		});
		for (const match of matches) {
			assertUnderSkeleton(root, match);
			files.add(match);
		}
	}

	const policies: PolicyFile[] = [];
	for (const abs of [...files].sort()) {
		if (!abs.endsWith(".yaml") && !abs.endsWith(".yml")) continue;
		assertUnderSkeleton(root, abs);
		policies.push(loadPolicyFile(abs, readFileSync(abs, "utf8")));
	}
	return policies;
}

/**
 * Load built `.mjs` plugins listed in config. Throws if a sibling `.mjs` is missing.
 */
export async function loadPlugins(root: string, config: SkeletonConfig): Promise<LoadedPlugins> {
	const entries = config.plugins ?? [];
	if (entries.length === 0) {
		return { rules: [], policies: [] };
	}

	const rules: AuditRule[] = [];
	const policies: PolicyFile[] = [];

	for (const entry of entries) {
		const tsAbs = resolvePluginTsPath(root, entry);
		const mjsAbs = mjsPathForTs(tsAbs);
		if (!existsSync(mjsAbs)) {
			const rel = relative(skeletonDir(root), tsAbs) || entry;
			throw new Error(
				`Plugin not built: ${rel} (missing ${relative(root, mjsAbs) || mjsAbs}). Run: skeleton build-plugin`,
			);
		}

		const mod = await import(pathToFileURL(mjsAbs).href);
		const normalized = normalizeExport(mod);
		rules.push(...normalized.rules);
		if (normalized.policies?.length) {
			policies.push(...loadPoliciesFromGlobs(root, normalized.policies));
		}
	}

	return { rules, policies };
}

export { mjsPathForTs, resolvePluginTsPath, skeletonDir };
