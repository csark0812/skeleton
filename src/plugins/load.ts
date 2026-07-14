import { existsSync, readFileSync } from "node:fs";
import { relative } from "node:path";
import { pathToFileURL } from "node:url";
import { globSync } from "tinyglobby";
import type { SkeletonConfig } from "../audit/config/types.ts";
import { normalizeRelPath } from "../audit/core/shared.ts";
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
	if (!mod || typeof mod !== "object") {
		throw new Error("Plugin module must export { rules: AuditRule[]; policies?: string[] }");
	}

	const record = mod as Record<string, unknown>;
	const namedRules = Array.isArray(record.rules) ? (record.rules as AuditRule[]) : undefined;
	const namedPoliciesRaw = "policies" in record ? record.policies : undefined;
	const def =
		"default" in record && record.default && typeof record.default === "object"
			? (record.default as Record<string, unknown>)
			: null;
	const defaultRules = def && Array.isArray(def.rules) ? (def.rules as AuditRule[]) : undefined;
	const defaultPoliciesRaw = def && "policies" in def ? def.policies : undefined;

	// Default is primary; named fills missing fields. Conflicting policies fail closed.
	const rules = defaultRules ?? namedRules;

	let policies: unknown;
	if (defaultPoliciesRaw !== undefined && namedPoliciesRaw !== undefined) {
		if (
			!Array.isArray(defaultPoliciesRaw) ||
			!Array.isArray(namedPoliciesRaw) ||
			defaultPoliciesRaw.length !== namedPoliciesRaw.length ||
			defaultPoliciesRaw.some((p, i) => p !== namedPoliciesRaw[i])
		) {
			throw new Error(
				"Plugin exports disagree on policies: default and named `policies` must match when both are set",
			);
		}
		policies = defaultPoliciesRaw;
	} else {
		policies = defaultPoliciesRaw ?? namedPoliciesRaw;
	}

	if (!Array.isArray(rules)) {
		throw new Error("Plugin module must export { rules: AuditRule[]; policies?: string[] }");
	}

	for (const rule of rules) {
		if (!rule || typeof rule.id !== "string" || typeof rule.run !== "function") {
			throw new Error("Plugin rules must each have string id and run()");
		}
	}

	if (policies !== undefined) {
		if (!Array.isArray(policies) || policies.some((p) => typeof p !== "string")) {
			throw new Error(
				"Plugin policies must be string[] (globs relative to .skeleton/) — got non-array",
			);
		}
	}

	return {
		rules,
		policies: policies as string[] | undefined,
	};
}

/** Expand plugin policy globs under `.skeleton/` to absolute YAML paths. */
export function expandPolicyGlobs(root: string, globs: string[]): string[] {
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
			if (match.endsWith(".yaml") || match.endsWith(".yml")) {
				files.add(match);
			}
		}
	}
	return [...files].sort();
}

function loadPoliciesFromGlobs(root: string, globs: string[]): PolicyFile[] {
	const files = expandPolicyGlobs(root, globs);
	const policies: PolicyFile[] = [];
	for (const abs of files) {
		assertUnderSkeleton(root, abs);
		policies.push(loadPolicyFile(abs, readFileSync(abs, "utf8")));
	}
	if (globs.length > 0 && policies.length === 0) {
		throw new Error(
			`Plugin policies matched no YAML under .skeleton/: ${globs.join(", ")}. Fix the glob or add policy files.`,
		);
	}
	return policies;
}

/**
 * Relpaths (from repo root) of YAML matched by any configured plugin `policies` glob.
 * Used by `validate changed` so the policy bucket matches the runtime load path.
 */
export async function collectWiredPolicyRelPaths(
	root: string,
	config: SkeletonConfig,
): Promise<Set<string>> {
	const entries = config.plugins ?? [];
	const wired = new Set<string>();
	if (entries.length === 0) return wired;

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
		if (!normalized.policies?.length) continue;
		for (const abs of expandPolicyGlobs(root, normalized.policies)) {
			wired.add(normalizeRelPath(relative(root, abs)));
		}
	}
	return wired;
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
