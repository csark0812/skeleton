import { describe, expect, it } from "bun:test";
import { unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { resolveCustomize } from "../../customize/resolve.ts";
import { registerPath } from "../../register.ts";
import { runAudit } from "../../audit/run.ts";
import { runValidateChanged } from "../../validate/changed.ts";

const FIXTURES = join(import.meta.dir, "../../audit/__tests__/fixtures");
const NESTED_SKILLS_CUSTOMIZE = join(FIXTURES, "nested-skills-customize");
const FLAT_SKILL_ROOT = join(FIXTURES, "flat-skill-root");

describe("register", () => {
	it("registers a doc with banner topic", () => {
		const docPath = join(NESTED_SKILLS_CUSTOMIZE, "docs/new-doc.md");
		writeFileSync(docPath, "**Source of truth for** New API doc.\n");
		try {
			const result = registerPath({
				root: NESTED_SKILLS_CUSTOMIZE,
				path: "docs/new-doc.md",
				dryRun: true,
			});
			expect(result.topic).toBe("New API doc.");
			expect(result.registryLink).toBe("../docs/new-doc.md");
		} finally {
			unlinkSync(docPath);
		}
	});

	it("prefixes customize topic", () => {
		const result = registerPath({
			root: NESTED_SKILLS_CUSTOMIZE,
			path: ".skeleton/customize/code-review.md",
			dryRun: true,
		});
		expect(result.topic.startsWith("Customize:")).toBe(true);
	});
});

describe("customize resolve", () => {
	it("returns customize file contents for slug", () => {
		const result = resolveCustomize(NESTED_SKILLS_CUSTOMIZE, "code-review");
		expect(result.content).toContain("Code review customize");
	});

	it("returns null for missing slug", () => {
		const result = resolveCustomize(NESTED_SKILLS_CUSTOMIZE, "missing-slug");
		expect(result.content).toBeNull();
	});
});

describe("audit global scoping", () => {
	it("skips global rules on path-scoped docs audit", () => {
		const exit = runAudit({
			suite: "docs",
			strict: false,
			json: false,
			paths: ["docs/README.md"],
			only: new Set(["scan-roots"]),
			root: FLAT_SKILL_ROOT,
			pathScopedOnly: true,
		});
		expect(exit).toBe(0);
	});

	it("runs global rules when globalOnly", () => {
		const exit = runAudit({
			suite: "self",
			strict: false,
			json: false,
			paths: [],
			only: new Set(["scan-roots"]),
			root: FLAT_SKILL_ROOT,
			globalOnly: true,
		});
		expect(exit).toBe(0);
	});
});

describe("validate changed routing", () => {
	it("validates explicit doc path", () => {
		const exit = runValidateChanged({
			root: FLAT_SKILL_ROOT,
			paths: ["docs/README.md"],
		});
		expect(exit).toBe(0);
	});

	it("skips ts paths", () => {
		const exit = runValidateChanged({
			root: FLAT_SKILL_ROOT,
			paths: ["src/cli.ts"],
		});
		expect(exit).toBe(0);
	});
});
