import { describe, expect, it } from "bun:test";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runGeneratedReferencesCheck } from "../check.ts";
import { isGeneratedReference, stripGeneratedHeader } from "../constants.ts";
import {
	discoverSkillReferencePlans,
	findSharedRefLinks,
	rewriteSharedRefTarget,
} from "../discover.ts";
import { syncReferences } from "../sync.ts";

const FIXTURE = join(import.meta.dir, "fixtures", "reference-sync");

describe("references", () => {
	it("discovers shared ref links from skill markdown", () => {
		const links = findSharedRefLinks(
			"Read [dialogue-contract.md](../references/dialogue-contract.md) and [build.md](../references/planning/build.md).",
			"crystallize/SKILL.md",
		);
		expect(links.map((l) => l.refPath)).toEqual(["dialogue-contract.md", "planning/build.md"]);
	});

	it("rewrites shared ref targets relative to source file", () => {
		expect(
			rewriteSharedRefTarget("crystallize/SKILL.md", "crystallize", "dialogue-contract.md"),
		).toBe("references/dialogue-contract.md");
		expect(
			rewriteSharedRefTarget("code-review/references/output.md", "code-review", "output-schema.md"),
		).toBe("output-schema.md");
	});

	it("syncs canonical refs into skill references with provenance", () => {
		const root = join(FIXTURE, "case-sync");
		rmSync(root, { recursive: true, force: true });
		mkdirSync(join(root, ".skeleton", "references"), { recursive: true });
		mkdirSync(join(root, "demo"), { recursive: true });
		writeFileSync(join(root, ".skeleton", "references", "shared.md"), "# Shared\n");
		writeFileSync(join(root, "demo", "SKILL.md"), "See [shared.md](../references/shared.md).\n");

		const result = syncReferences({ root });
		expect(result.written).toEqual(["demo/references/shared.md"]);
		expect(result.rewritten).toEqual(["demo/SKILL.md"]);

		const generated = readFileSync(join(root, "demo", "references", "shared.md"), "utf8");
		expect(isGeneratedReference(generated)).toBe(true);
		expect(stripGeneratedHeader(generated)).toBe("# Shared\n");

		const skill = readFileSync(join(root, "demo", "SKILL.md"), "utf8");
		expect(skill).toContain("(references/shared.md)");
		expect(skill).not.toContain("../references/");
	});

	it("check fails on stale generated copies", () => {
		const root = join(FIXTURE, "case-check");
		rmSync(root, { recursive: true, force: true });
		mkdirSync(join(root, ".skeleton", "references"), { recursive: true });
		mkdirSync(join(root, "demo", "references"), { recursive: true });
		writeFileSync(join(root, ".skeleton", "references", "shared.md"), "# Canonical\n");
		writeFileSync(join(root, "demo", "SKILL.md"), "See [shared.md](references/shared.md).\n");
		writeFileSync(
			join(root, "demo", "references", "shared.md"),
			`<!-- skeleton: generated-reference
source: .skeleton/references/shared.md
redundancy: intentional
-->

# Stale
`,
		);

		const issues = runGeneratedReferencesCheck(root);
		expect(issues.some((i) => i.message.includes("stale generated copy"))).toBe(true);
	});

	it("plans references per skill from disk", () => {
		const root = join(FIXTURE, "case-sync");
		const plans = discoverSkillReferencePlans(root);
		expect(plans).toHaveLength(1);
		expect(plans[0]?.skill).toBe("demo");
		expect([...(plans[0]?.refPaths ?? [])]).toEqual(["shared.md"]);
	});

	it("plans transitive canonical siblings linked from discovered refs", () => {
		const root = join(FIXTURE, "case-transitive");
		rmSync(root, { recursive: true, force: true });
		mkdirSync(join(root, ".skeleton", "references", "planning"), {
			recursive: true,
		});
		mkdirSync(join(root, "demo"), { recursive: true });
		writeFileSync(
			join(root, ".skeleton", "references", "handoffs.md"),
			"See [verify.md](planning/verify.md).\n",
		);
		writeFileSync(join(root, ".skeleton", "references", "planning", "verify.md"), "# Verify\n");
		writeFileSync(join(root, "demo", "SKILL.md"), "See [handoffs.md](references/handoffs.md).\n");

		const plans = discoverSkillReferencePlans(root);
		expect(plans).toHaveLength(1);
		expect([...(plans[0]?.refPaths ?? [])].sort()).toEqual(["handoffs.md", "planning/verify.md"]);
	});

	it("skips foreign lockfile skills when ownership is provided", () => {
		const root = join(FIXTURE, "case-ownership");
		rmSync(root, { recursive: true, force: true });
		mkdirSync(join(root, ".skeleton", "references"), { recursive: true });
		mkdirSync(join(root, "foreign-skill"), { recursive: true });
		mkdirSync(join(root, "owned-skill"), { recursive: true });
		writeFileSync(join(root, ".skeleton", "references", "shared.md"), "# Shared\n");
		writeFileSync(
			join(root, "foreign-skill", "SKILL.md"),
			"See [shared.md](../references/shared.md).\n",
		);
		writeFileSync(
			join(root, "owned-skill", "SKILL.md"),
			"See [shared.md](../references/shared.md).\n",
		);
		writeFileSync(
			join(root, "custom-lock.json"),
			JSON.stringify({
				version: 1,
				skills: {
					"foreign-skill": { source: "org/toolbox", sourceType: "github" },
				},
			}),
		);

		const plans = discoverSkillReferencePlans(root, { lockfile: "custom-lock.json" });
		expect(plans.map((p) => p.skill)).toEqual(["owned-skill"]);

		const withoutOwnership = discoverSkillReferencePlans(root);
		expect(withoutOwnership.map((p) => p.skill).sort()).toEqual(["foreign-skill", "owned-skill"]);
	});
});
