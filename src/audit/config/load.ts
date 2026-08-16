import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import Ajv from "ajv";
import { parse as parseToml } from "smol-toml";
import { parse as parseYaml } from "yaml";
import { validateDraftPathPrefixes } from "../core/draft.ts";
import type { SkeletonConfig } from "./types.ts";

const SCHEMA_CANDIDATES = [
	// src/audit/config/load.ts → ../../../schemas
	join(dirname(fileURLToPath(import.meta.url)), "../../../schemas/config.schema.json"),
	// dist/cli.js → ../schemas
	join(dirname(fileURLToPath(import.meta.url)), "../schemas/config.schema.json"),
	// dist/hooks/customize-on-skill-read.js → ../../schemas
	join(dirname(fileURLToPath(import.meta.url)), "../../schemas/config.schema.json"),
];

export const ROOT_CONFIG_TOML = "skeleton.toml";
export const LEGACY_CONFIG_YAML = join(".skeleton", "config.yaml");

function resolveSchemaPath(): string {
	for (const candidate of SCHEMA_CANDIDATES) {
		if (existsSync(candidate)) return candidate;
	}
	throw new Error("Missing schemas/config.schema.json in package");
}

/** Built-in exclude patterns applied to scan and deny.paths passes. */
export const BUILTIN_EXCLUDES = ["node_modules/**", ".git/**", "dist/**", "refs/**", "_agent/**"];

/** Built-in excludes for coverage-gaps candidate discovery. */
export const COVERAGE_BUILTIN_EXCLUDES = [
	...BUILTIN_EXCLUDES,
	"**/__tests__/**",
	"**/fixtures/**",
	"templates/**",
];

function hasConfigMarker(dir: string): boolean {
	return existsSync(join(dir, ROOT_CONFIG_TOML)) || existsSync(join(dir, LEGACY_CONFIG_YAML));
}

export function findRepoRoot(startDir = process.cwd()): string {
	let dir = startDir;
	while (true) {
		if (hasConfigMarker(dir)) return dir;
		const parent = dirname(dir);
		if (parent === dir) {
			throw new Error(
				`No ${ROOT_CONFIG_TOML} or ${LEGACY_CONFIG_YAML} found — run skeleton init or create config manually`,
			);
		}
		dir = parent;
	}
}

function validateConfig(raw: unknown, sourceLabel: string): SkeletonConfig {
	const schema = JSON.parse(readFileSync(resolveSchemaPath(), "utf8"));
	const ajv = new Ajv({ allErrors: true, strict: false });
	const validate = ajv.compile(schema);
	if (!validate(raw)) {
		const detail = validate.errors?.map((e) => `${e.instancePath || "/"} ${e.message}`).join("; ");
		throw new Error(`Invalid ${sourceLabel}: ${detail ?? "schema validation failed"}`);
	}
	const config = raw as SkeletonConfig;
	validateDraftPathPrefixes(config.draftPathPrefixes);
	return config;
}

export interface LoadConfigResult {
	config: SkeletonConfig;
	source: "toml" | "yaml";
	warnedDual?: boolean;
}

export function loadConfigDetailed(root: string): LoadConfigResult {
	const tomlPath = join(root, ROOT_CONFIG_TOML);
	const yamlPath = join(root, LEGACY_CONFIG_YAML);
	const hasToml = existsSync(tomlPath);
	const hasYaml = existsSync(yamlPath);

	if (!(hasToml || hasYaml)) {
		throw new Error(`Missing ${ROOT_CONFIG_TOML} (or legacy ${LEGACY_CONFIG_YAML})`);
	}

	if (hasToml && hasYaml) {
		console.error(
			`warning: both ${ROOT_CONFIG_TOML} and ${LEGACY_CONFIG_YAML} exist — using ${ROOT_CONFIG_TOML}; legacy YAML is ignored`,
		);
	}

	if (hasToml) {
		const raw = parseToml(readFileSync(tomlPath, "utf8"));
		return {
			config: validateConfig(raw, ROOT_CONFIG_TOML),
			source: "toml",
			warnedDual: hasToml && hasYaml,
		};
	}

	const raw = parseYaml(readFileSync(yamlPath, "utf8"));
	return {
		config: validateConfig(raw, LEGACY_CONFIG_YAML),
		source: "yaml",
	};
}

export function loadConfig(root: string): SkeletonConfig {
	return loadConfigDetailed(root).config;
}

export function mergedExcludes(config: SkeletonConfig): string[] {
	return [...new Set([...BUILTIN_EXCLUDES, ...config.scan.exclude])];
}

export function denyPaths(config: SkeletonConfig): string[] {
	return config.deny?.paths ?? [];
}

export function nonPublicSkills(config: SkeletonConfig): string[] {
	return config.scan.nonPublicSkills ?? [];
}
