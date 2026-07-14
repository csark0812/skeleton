import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv from "ajv";
import { parse as parseYaml } from "yaml";
import { matchesGlobScope } from "../core/shared.ts";
import type { MatchedPolicyEntry, PolicyEntry, PolicyFile, PolicyFileYaml } from "./types.ts";

const SCHEMA_CANDIDATES = [
	// src/audit/policies/load.ts → ../../../schemas
	join(dirname(fileURLToPath(import.meta.url)), "../../../schemas/policy-file.schema.json"),
	// dist/cli.js → ../schemas
	join(dirname(fileURLToPath(import.meta.url)), "../schemas/policy-file.schema.json"),
	// dist/hooks → ../../schemas
	join(dirname(fileURLToPath(import.meta.url)), "../../schemas/policy-file.schema.json"),
];

function resolvePolicySchemaPath(): string {
	for (const candidate of SCHEMA_CANDIDATES) {
		if (existsSync(candidate)) return candidate;
	}
	throw new Error("Missing schemas/policy-file.schema.json in package");
}

function validatePolicyYaml(raw: unknown, label: string): PolicyFileYaml {
	const schema = JSON.parse(readFileSync(resolvePolicySchemaPath(), "utf8"));
	const ajv = new Ajv({ allErrors: true, strict: false });
	const validate = ajv.compile(schema);
	if (!validate(raw)) {
		const detail = validate.errors?.map((e) => `${e.instancePath || "/"} ${e.message}`).join("; ");
		throw new Error(`Invalid policy ${label}: ${detail ?? "schema validation failed"}`);
	}
	return raw as PolicyFileYaml;
}

function parsePolicyYaml(content: string, fileStem: string): PolicyFileYaml {
	const parsed = parseYaml(content) as PolicyFileYaml | PolicyEntry[];
	if (Array.isArray(parsed)) {
		throw new Error(
			`Policy ${fileStem}.yaml must use Policy File shape (name + entries) — see schemas/policy-file.schema.json`,
		);
	}
	if (!parsed || typeof parsed !== "object") {
		throw new Error(`Policy ${fileStem}.yaml missing required 'entries' array`);
	}
	return validatePolicyYaml(parsed, `${fileStem}.yaml`);
}

/**
 * Compile YAML entries. Case-insensitive matching by default; policy name
 * `skill-hub-duplication` is always case-sensitive (PostPrint convention).
 * Patterns starting with `^` omit the `i` flag even when case-insensitive.
 */
export function compilePolicy(name: string, raw: PolicyEntry[]): PolicyFile {
	const caseInsensitive = name !== "skill-hub-duplication";
	const entries = raw.map((entry) => {
		const mode = entry.mode ?? "pattern";
		if (mode === "fingerprint") {
			return { ...entry, mode, regex: null as RegExp | null };
		}
		if (!entry.pattern) {
			throw new Error(`Policy ${name} entry ${entry.id} requires pattern when mode is pattern`);
		}
		let regex: RegExp;
		try {
			const flags = entry.pattern.startsWith("^") || !caseInsensitive ? "" : "i";
			regex = new RegExp(entry.pattern, flags);
		} catch (err) {
			throw new Error(
				`Invalid regex in policy ${name} entry ${entry.id}: ${entry.pattern} — ${err}`,
			);
		}
		return { ...entry, mode, regex };
	});
	return { name, entries };
}

export function loadPolicyFile(absPath: string, content: string): PolicyFile {
	const stem = basename(absPath, extname(absPath));
	const { name, entries } = parsePolicyYaml(content, stem);
	return compilePolicy(name || stem, entries);
}

export function policiesForFile(policies: PolicyFile[], relPath: string): MatchedPolicyEntry[] {
	const matched: MatchedPolicyEntry[] = [];
	for (const policy of policies) {
		for (const entry of policy.entries) {
			if (matchesGlobScope(relPath, entry.scope)) {
				matched.push({ ...entry, policyName: policy.name });
			}
		}
	}
	return matched;
}
