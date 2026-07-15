import type { SkillIndex } from "../core/skill-roots.ts";

/** Empty skill index for unit tests that do not exercise skill discovery. */
export const EMPTY_SKILL_INDEX: SkillIndex = {
	roots: [],
	slugs: [],
	flatSlugs: [],
	ownedSlugs: [],
	foreignSlugs: [],
	provenance: { lockfile: null, entries: {}, warnings: [] },
};
