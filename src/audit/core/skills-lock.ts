import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const SKILLS_LOCK_REL = "skills-lock.json";

interface SkillsLockFile {
	skills?: Record<string, unknown>;
}

/**
 * Slugs of externally-synced skills declared in `skills-lock.json`.
 *
 * These skill trees are managed by an upstream source (toolbox / framework), so
 * their review cadence is tracked at the source — consumer-side git dates only
 * reflect when they were synced, not when they were reviewed. Empty set when the
 * lock file is absent or unreadable.
 */
export function lockedSkillSlugs(root: string): Set<string> {
	const abs = join(root, SKILLS_LOCK_REL);
	if (!existsSync(abs)) return new Set();
	try {
		const parsed = JSON.parse(readFileSync(abs, "utf8")) as SkillsLockFile;
		return new Set(Object.keys(parsed.skills ?? {}));
	} catch {
		return new Set();
	}
}
