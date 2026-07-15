import type { SkillOwnershipConfig } from "../config/types.ts";
import {
	DEFAULT_SKILLS_LOCKFILE,
	isForeignLockSourceType,
	loadSkillsLock,
} from "./skill-provenance.ts";

/**
 * Slugs of externally-synced skills declared in `skills-lock.json`.
 *
 * Prefer `skillIndex.foreignSlugs` once an index is built (respects config overrides).
 * This helper remains for lightweight callers and tests: non-`local` lock entries only.
 * Empty set when the lock file is absent or unreadable.
 */
export function lockedSkillSlugs(root: string, ownership?: SkillOwnershipConfig): Set<string> {
	const lockfile = ownership?.lockfile ?? DEFAULT_SKILLS_LOCKFILE;
	const provenance = loadSkillsLock(root, lockfile);
	const locked = new Set<string>();
	for (const [slug, entry] of Object.entries(provenance.entries)) {
		if (isForeignLockSourceType(entry.sourceType)) locked.add(slug);
	}
	for (const slug of ownership?.foreignSlugs ?? []) locked.add(slug);
	for (const slug of ownership?.ownedSlugs ?? []) locked.delete(slug);
	return locked;
}
