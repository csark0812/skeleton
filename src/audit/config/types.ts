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
	plugins?: string[];
}
