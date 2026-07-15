import { describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../config/load.ts";
import type { AuditContext } from "../core/context.ts";
import { buildSkillIndex } from "../core/skill-roots.ts";
import { runSkillIndexRule } from "../rules/skill-index.ts";

function writeMinimalConfig(root: string): void {
	mkdirSync(join(root, ".skeleton"), { recursive: true });
	writeFileSync(
		join(root, ".skeleton", "config.yaml"),
		`scan:
  include: ["docs/**"]
  exclude: []
  banned: []
daysUntilStale: 180
`,
	);
	writeFileSync(join(root, ".skeleton", "registry.md"), "# Registry\n");
}

describe("skill-index rule", () => {
	it("does not scan top-level dirs that share a nested-only owned slug name", () => {
		const root = mkdtempSync(join(tmpdir(), "skeleton-skill-index-flat-"));
		try {
			writeMinimalConfig(root);
			mkdirSync(join(root, "docs"), { recursive: true });
			writeFileSync(join(root, "docs", "README.md"), "# docs\n");

			// Flat skill keeps a flat root present.
			mkdirSync(join(root, "skeleton"), { recursive: true });
			writeFileSync(join(root, "skeleton", "SKILL.md"), "# owned flat\n");

			// Nested-only owned skill.
			mkdirSync(join(root, ".claude", "skills", "code-review"), { recursive: true });
			writeFileSync(join(root, ".claude", "skills", "code-review", "SKILL.md"), "# nested\n");

			// Same-named top-level dir that is NOT a skill — must not be scanned.
			mkdirSync(join(root, "code-review"), { recursive: true });
			writeFileSync(
				join(root, "code-review", "notes.md"),
				"See [missing](ghost/SKILL.md) for context.\n",
			);

			const config = loadConfig(root);
			const skillIndex = buildSkillIndex(root, config.skillOwnership);
			expect(skillIndex.flatSlugs).toEqual(["skeleton"]);
			expect(skillIndex.ownedSlugs.sort()).toEqual(["code-review", "skeleton"]);

			const ctx = {
				root,
				config,
				files: [],
				docMetaPaths: [],
				registryPaths: [],
				registryHasTableHeader: false,
				retiredSkills: new Set<string>(),
				skillIndex,
				lockedSkillSlugs: new Set<string>(),
				policies: [],
			} as AuditContext;

			const issues = runSkillIndexRule(ctx);
			expect(issues.some((i) => i.file.includes("code-review/notes.md"))).toBe(false);
			expect(issues.some((i) => i.message.includes("ghost"))).toBe(false);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});
