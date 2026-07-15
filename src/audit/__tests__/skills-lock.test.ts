import { describe, expect, it } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { lockedSkillSlugs } from "../core/skills-lock.ts";

function withRoot(run: (root: string) => void): void {
	const root = join(tmpdir(), `skeleton-lock-${Date.now()}-${Math.random().toString(36).slice(2)}`);
	mkdirSync(root, { recursive: true });
	try {
		run(root);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
}

describe("lockedSkillSlugs", () => {
	it("returns the skill slugs declared in skills-lock.json", () => {
		withRoot((root) => {
			writeFileSync(
				join(root, "skills-lock.json"),
				JSON.stringify({ version: 1, skills: { multi: {}, "code-review": {} } }),
			);
			expect(lockedSkillSlugs(root)).toEqual(new Set(["multi", "code-review"]));
		});
	});

	it("returns an empty set when the lock file is absent", () => {
		withRoot((root) => {
			expect(lockedSkillSlugs(root).size).toBe(0);
		});
	});

	it("returns an empty set when the lock file is malformed", () => {
		withRoot((root) => {
			writeFileSync(join(root, "skills-lock.json"), "{ not json");
			expect(lockedSkillSlugs(root).size).toBe(0);
		});
	});
});
