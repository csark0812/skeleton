export interface ScanConfig {
	include: string[];
	exclude: string[];
	banned: string[];
	retiredSkills?: string[];
	/** Slugs present on disk but excluded from README Taxonomy (internal skills). */
	nonPublicSkills?: string[];
}

export interface CustomizeConfig {
	/** Basenames under `.skeleton/customize/` appended on every customize inject. */
	alwaysInclude?: string[];
}

/**
 * Ownership policy for skill-body linting.
 * Lockfile `sourceType` other than `local` (e.g. `github`) marks skills foreign by default.
 */
export interface SkillOwnershipConfig {
	/** Repo-relative path to skills-lock.json (default: skills-lock.json). */
	lockfile?: string;
	/** Force these slugs owned even if the lockfile marks them foreign. */
	ownedSlugs?: string[];
	/** Force these slugs foreign even if absent from the lockfile / local. */
	foreignSlugs?: string[];
}

export interface SkeletonConfig {
	scan: ScanConfig;
	daysUntilStale: number;
	customize?: CustomizeConfig;
	skillOwnership?: SkillOwnershipConfig;
	/**
	 * Plugin entry paths relative to `.skeleton/` (e.g. `plugins/example.ts`).
	 * Each entry must have a built sibling `.mjs` (`skeleton build-plugin`).
	 */
	plugins?: string[];
	/**
	 * Path prefixes where `draft-marker` prose-policy placement is allowed
	 * (in addition to `_draft-*.md` filenames). Not the same as `scan.exclude`.
	 */
	draftPathPrefixes?: string[];
}
