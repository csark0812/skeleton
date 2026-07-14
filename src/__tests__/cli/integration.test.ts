import { describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { runAudit } from "../../audit/run.ts";
import { resolveCustomize } from "../../customize/resolve.ts";
import { registerPath } from "../../register.ts";
import { codeValidationHint, runValidateChanged } from "../../validate/changed.ts";

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

	it("fails when all paths are skipped code", () => {
		const tsPath = join(FLAT_SKILL_ROOT, "src/example.ts");
		const tsDir = dirname(tsPath);
		mkdirSync(tsDir, { recursive: true });
		writeFileSync(tsPath, "export const n = 1;\n");
		try {
			const exit = runValidateChanged({
				root: FLAT_SKILL_ROOT,
				paths: ["src/example.ts"],
			});
			expect(exit).toBe(1);
		} finally {
			rmSync(tsDir, { recursive: true, force: true });
		}
	});

	it("passes mixed docs and skipped ts", () => {
		const tsPath = join(FLAT_SKILL_ROOT, "src/example.ts");
		const tsDir = dirname(tsPath);
		mkdirSync(tsDir, { recursive: true });
		writeFileSync(tsPath, "export const n = 1;\n");
		try {
			const exit = runValidateChanged({
				root: FLAT_SKILL_ROOT,
				paths: ["docs/README.md", "src/example.ts"],
			});
			expect(exit).toBe(0);
		} finally {
			rmSync(tsDir, { recursive: true, force: true });
		}
	});

	it("fails skill-only paths without --base and points at audit skills", () => {
		const exit = runValidateChanged({
			root: FLAT_SKILL_ROOT,
			paths: ["multi/SKILL.md"],
		});
		expect(exit).toBe(1);
	});

	it("fails when all explicit paths are missing on disk", () => {
		const exit = runValidateChanged({
			root: FLAT_SKILL_ROOT,
			paths: ["docs/does-not-exist.md"],
		});
		expect(exit).toBe(1);
	});
});

describe("codeValidationHint", () => {
	it("prefers packageManager field (this repo is bun)", () => {
		expect(codeValidationHint(join(import.meta.dir, "../../.."))).toContain("bun test");
	});

	it("uses npm when package-lock.json is present without packageManager", () => {
		const dir = mkdtempSync(join(tmpdir(), "skeleton-hint-"));
		try {
			writeFileSync(join(dir, "package.json"), '{ "name": "x" }\n');
			writeFileSync(join(dir, "package-lock.json"), "{}\n");
			expect(codeValidationHint(dir)).toContain("npm test");
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
