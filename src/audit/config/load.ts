import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv from "ajv";
import { parse as parseYaml } from "yaml";
import type { SkeletonConfig } from "./types.ts";

const SCHEMA_CANDIDATES = [
	// src/audit/config/load.ts → ../../../schemas
	join(dirname(fileURLToPath(import.meta.url)), "../../../schemas/config.schema.json"),
	// dist/cli.js → ../schemas
	join(dirname(fileURLToPath(import.meta.url)), "../schemas/config.schema.json"),
	// dist/hooks/customize-on-skill-read.js → ../../schemas
	join(dirname(fileURLToPath(import.meta.url)), "../../schemas/config.schema.json"),
];

function resolveSchemaPath(): string {
	for (const candidate of SCHEMA_CANDIDATES) {
		if (existsSync(candidate)) return candidate;
	}
	throw new Error("Missing schemas/config.schema.json in package");
}

/** Built-in exclude patterns applied to scan and banned passes. */
export const BUILTIN_EXCLUDES = ["node_modules/**", ".git/**", "dist/**", "refs/**", "_agent/**"];

/** Built-in excludes for coverage-gaps candidate discovery. */
export const COVERAGE_BUILTIN_EXCLUDES = [
	...BUILTIN_EXCLUDES,
	"**/__tests__/**",
	"**/fixtures/**",
	"templates/**",
];

export function findRepoRoot(startDir = process.cwd()): string {
	let dir = startDir;
	while (true) {
		if (existsSync(join(dir, ".skeleton", "config.yaml"))) return dir;
		const parent = dirname(dir);
		if (parent === dir) {
			throw new Error(
				"No .skeleton/config.yaml found — run skeleton init or create config manually",
			);
		}
		dir = parent;
	}
}

function validateConfig(raw: unknown): SkeletonConfig {
	const schema = JSON.parse(readFileSync(resolveSchemaPath(), "utf8"));
	const ajv = new Ajv({ allErrors: true, strict: false });
	const validate = ajv.compile(schema);
	if (!validate(raw)) {
		const detail = validate.errors?.map((e) => `${e.instancePath || "/"} ${e.message}`).join("; ");
		throw new Error(`Invalid .skeleton/config.yaml: ${detail ?? "schema validation failed"}`);
	}
	return raw as SkeletonConfig;
}

export function loadConfig(root: string): SkeletonConfig {
	const configPath = join(root, ".skeleton", "config.yaml");
	if (!existsSync(configPath)) {
		throw new Error(`Missing ${join(".skeleton", "config.yaml")}`);
	}
	const raw = parseYaml(readFileSync(configPath, "utf8"));
	return validateConfig(raw);
}

export function mergedExcludes(config: SkeletonConfig): string[] {
	return [...new Set([...BUILTIN_EXCLUDES, ...config.scan.exclude])];
}

export function retiredSkills(config: SkeletonConfig): string[] {
	return config.scan.retiredSkills ?? [];
}

export function nonPublicSkills(config: SkeletonConfig): string[] {
	return config.scan.nonPublicSkills ?? [];
}
