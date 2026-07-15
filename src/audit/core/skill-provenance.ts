import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { SkillOwnershipConfig } from "../config/types.ts";

export const DEFAULT_SKILLS_LOCKFILE = "skills-lock.json";

export type SkillSourceType = "github" | "local" | string;

export interface SkillLockEntry {
	source: string;
	sourceType: SkillSourceType;
	skillPath?: string;
	computedHash?: string;
}

export interface SkillsLockFile {
	version: number;
	skills: Record<string, SkillLockEntry>;
}

export type SkillOwnership = "owned" | "foreign";

export interface SkillProvenanceMap {
	/** Repo-relative lockfile path that was read, or null when absent. */
	lockfile: string | null;
	/** Parsed lock entries keyed by slug (empty when no lock / empty lock). */
	entries: Record<string, SkillLockEntry>;
	/** Non-fatal parse / version problems. */
	warnings: string[];
}

/**
 * External lock provenance is treated as foreign (synced) by default.
 * `local` stays owned so same-repo installs (e.g. `skills add .`) keep linting.
 */
export function isForeignLockSourceType(sourceType: string): boolean {
	return sourceType !== "local";
}

export function loadSkillsLock(
	root: string,
	lockfileRel: string = DEFAULT_SKILLS_LOCKFILE,
): SkillProvenanceMap {
	const warnings: string[] = [];
	const abs = join(root, lockfileRel);
	if (!existsSync(abs)) {
		return { lockfile: null, entries: {}, warnings };
	}

	let raw: unknown;
	try {
		raw = JSON.parse(readFileSync(abs, "utf8"));
	} catch (error) {
		warnings.push(
			`malformed ${lockfileRel}: ${error instanceof Error ? error.message : String(error)}`,
		);
		return { lockfile: lockfileRel, entries: {}, warnings };
	}

	if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
		warnings.push(`${lockfileRel}: expected a JSON object`);
		return { lockfile: lockfileRel, entries: {}, warnings };
	}

	const obj = raw as Record<string, unknown>;
	if (obj.version !== 1) {
		warnings.push(
			`${lockfileRel}: unsupported version ${String(obj.version)} (expected 1); ignoring entries`,
		);
		return { lockfile: lockfileRel, entries: {}, warnings };
	}

	const skillsRaw = obj.skills;
	if (!skillsRaw || typeof skillsRaw !== "object" || Array.isArray(skillsRaw)) {
		warnings.push(`${lockfileRel}: missing or invalid "skills" object`);
		return { lockfile: lockfileRel, entries: {}, warnings };
	}

	const entries: Record<string, SkillLockEntry> = {};
	for (const [slug, value] of Object.entries(skillsRaw as Record<string, unknown>)) {
		if (!value || typeof value !== "object" || Array.isArray(value)) {
			warnings.push(`${lockfileRel}: skill "${slug}" has invalid entry`);
			continue;
		}
		const entry = value as Record<string, unknown>;
		const source = entry.source;
		const sourceType = entry.sourceType;
		if (typeof source !== "string" || source.length === 0) {
			warnings.push(`${lockfileRel}: skill "${slug}" missing source`);
			continue;
		}
		if (typeof sourceType !== "string" || sourceType.length === 0) {
			warnings.push(`${lockfileRel}: skill "${slug}" missing sourceType`);
			continue;
		}
		const parsed: SkillLockEntry = { source, sourceType };
		if (typeof entry.skillPath === "string") parsed.skillPath = entry.skillPath;
		if (typeof entry.computedHash === "string") parsed.computedHash = entry.computedHash;
		entries[slug] = parsed;
	}

	return { lockfile: lockfileRel, entries, warnings };
}

/**
 * Classify a discovered skill slug.
 * Precedence: config ownedSlugs → config foreignSlugs → lock provenance → owned default.
 */
export function classifySkillOwnership(
	slug: string,
	provenance: SkillProvenanceMap,
	ownership?: SkillOwnershipConfig,
): SkillOwnership {
	const ownedOverrides = new Set(ownership?.ownedSlugs ?? []);
	const foreignOverrides = new Set(ownership?.foreignSlugs ?? []);
	if (ownedOverrides.has(slug)) return "owned";
	if (foreignOverrides.has(slug)) return "foreign";

	const entry = provenance.entries[slug];
	if (entry && isForeignLockSourceType(entry.sourceType)) return "foreign";
	return "owned";
}

export function resolveOwnershipForSlugs(
	slugs: string[],
	provenance: SkillProvenanceMap,
	ownership?: SkillOwnershipConfig,
): { ownedSlugs: string[]; foreignSlugs: string[] } {
	const ownedSlugs: string[] = [];
	const foreignSlugs: string[] = [];
	for (const slug of slugs) {
		if (classifySkillOwnership(slug, provenance, ownership) === "foreign") {
			foreignSlugs.push(slug);
		} else {
			ownedSlugs.push(slug);
		}
	}
	return { ownedSlugs, foreignSlugs };
}
