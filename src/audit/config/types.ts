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

export interface SkeletonConfig {
	scan: ScanConfig;
	daysUntilStale: number;
	customize?: CustomizeConfig;
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
