export interface ScanConfig {
	include: string[];
	exclude: string[];
	banned: string[];
	retiredSkills?: string[];
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
