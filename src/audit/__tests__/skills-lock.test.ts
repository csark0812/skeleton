import { describe, expect, it } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	classifySkillOwnership,
	loadSkillsLock,
	resolveOwnershipForSlugs,
} from "../core/skill-provenance.ts";
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

describe("loadSkillsLock", () => {
	it("parses version-1 lock entries", () => {
		withRoot((root) => {
			writeFileSync(
				join(root, "skills-lock.json"),
				JSON.stringify({
					version: 1,
					skills: {
						multi: {
							source: "csark0812/toolbox",
							sourceType: "github",
							skillPath: "multi/SKILL.md",
							computedHash: "abc",
						},
						skeleton: { source: ".", sourceType: "local" },
					},
				}),
			);
			const provenance = loadSkillsLock(root);
			expect(provenance.lockfile).toBe("skills-lock.json");
			expect(provenance.entries.multi?.sourceType).toBe("github");
			expect(provenance.entries.skeleton?.sourceType).toBe("local");
			expect(provenance.warnings).toEqual([]);
		});
	});

	it("warns on malformed lock without throwing", () => {
		withRoot((root) => {
			writeFileSync(join(root, "skills-lock.json"), "{ not json");
			const provenance = loadSkillsLock(root);
			expect(provenance.entries).toEqual({});
			expect(provenance.warnings.length).toBeGreaterThan(0);
		});
	});
});

describe("classifySkillOwnership", () => {
	it("marks github lock entries foreign and local owned", () => {
		const provenance = {
			lockfile: "skills-lock.json",
			entries: {
				multi: { source: "csark0812/toolbox", sourceType: "github" },
				skeleton: { source: ".", sourceType: "local" },
			},
			warnings: [],
		};
		expect(classifySkillOwnership("multi", provenance)).toBe("foreign");
		expect(classifySkillOwnership("skeleton", provenance)).toBe("owned");
		expect(classifySkillOwnership("local-only", provenance)).toBe("owned");
	});

	it("respects ownedSlugs / foreignSlugs overrides", () => {
		const provenance = {
			lockfile: "skills-lock.json",
			entries: {
				multi: { source: "csark0812/toolbox", sourceType: "github" },
			},
			warnings: [],
		};
		expect(classifySkillOwnership("multi", provenance, { ownedSlugs: ["multi"] })).toBe("owned");
		expect(classifySkillOwnership("custom", provenance, { foreignSlugs: ["custom"] })).toBe(
			"foreign",
		);
	});

	it("resolveOwnershipForSlugs partitions discovered slugs", () => {
		const provenance = {
			lockfile: "skills-lock.json",
			entries: {
				multi: { source: "csark0812/toolbox", sourceType: "github" },
			},
			warnings: [],
		};
		expect(resolveOwnershipForSlugs(["multi", "mine"], provenance)).toEqual({
			ownedSlugs: ["mine"],
			foreignSlugs: ["multi"],
		});
	});
});

describe("lockedSkillSlugs", () => {
	it("returns foreign (non-local) lock slugs only", () => {
		withRoot((root) => {
			writeFileSync(
				join(root, "skills-lock.json"),
				JSON.stringify({
					version: 1,
					skills: {
						multi: { source: "csark0812/toolbox", sourceType: "github" },
						"code-review": { source: "csark0812/toolbox", sourceType: "github" },
						skeleton: { source: ".", sourceType: "local" },
					},
				}),
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

	it("applies ownership overrides", () => {
		withRoot((root) => {
			writeFileSync(
				join(root, "skills-lock.json"),
				JSON.stringify({
					version: 1,
					skills: {
						multi: { source: "csark0812/toolbox", sourceType: "github" },
					},
				}),
			);
			expect(lockedSkillSlugs(root, { ownedSlugs: ["multi"] }).size).toBe(0);
			expect(lockedSkillSlugs(root, { foreignSlugs: ["mine"] })).toEqual(
				new Set(["multi", "mine"]),
			);
		});
	});
});
