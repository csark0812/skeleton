export interface ScanConfig {
	include: string[];
	exclude: string[];
	/** Slugs present on disk but excluded from README Taxonomy (internal skills). */
	nonPublicSkills?: string[];
}

export interface DenyConfig {
	/** Repo-wide globs that must not exist — audit fails if matched. */
	paths?: string[];
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

/** Tunables for near-duplicate, SSOT-summary, and code-fit docs lint. */
export interface DocsLintConfig {
	/** Jaccard threshold on word shingles (0–1). Default 0.72. */
	nearDuplicateThreshold?: number;
	/** Min fraction of SSOT tokens that must appear in evidence (default 0.35). */
	ssotOverlapMin?: number;
	/** Margin by which another file must beat own overlap for better-match (default 0.15). */
	ssotBetterMatchMargin?: number;
	/** When overlap fails, mention missing SSOT phrase in the message (default true). */
	ssotPhraseCheck?: boolean;
	/** Repo-relative path pairs to skip in near-dupe / duplicate-SSOT checks. */
	ignorePairs?: [string, string][];
	/** Globs excluded from near-dupe / duplicate-SSOT (still catalogued if they have SSOT). */
	ignoreGlobs?: string[];
	/**
	 * Min fraction of code identifiers that must appear in the doc (code-fit).
	 * Default 0.03 — separate from ssotOverlapMin (doc-grounding vs large modules).
	 */
	codeFitOverlapMin?: number;
	/** Max auto-extracted surface names before surface= is required (default 25). */
	codeFitSurfaceCap?: number;
}

export interface SkeletonConfig {
	scan: ScanConfig;
	/** Re-read cadence (days) for doc-meta last-reviewed; separate from git edit-behind-review. */
	daysUntilStale: number;
	deny?: DenyConfig;
	customize?: CustomizeConfig;
	skillOwnership?: SkillOwnershipConfig;
	docsLint?: DocsLintConfig;
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
