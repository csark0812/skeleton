import { beforeAll, describe, expect, it, spyOn } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runAudit } from "../../audit/run.ts";
import { resolveCustomize } from "../../customize/resolve.ts";
import { runBuildPlugin } from "../../plugins/build.ts";
import { registerPath } from "../../register.ts";
import { codeValidationHint, runValidateChanged } from "../../validate/changed.ts";

const FIXTURES = join(import.meta.dir, "../../audit/__tests__/fixtures");
const NESTED_SKILLS_CUSTOMIZE = join(FIXTURES, "nested-skills-customize");
const FLAT_SKILL_ROOT = join(FIXTURES, "flat-skill-root");
const PLUGIN_CONSUMER = join(FIXTURES, "plugins/consumer");

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
	it("skips global rules on path-scoped docs audit", async () => {
		const exit = await runAudit({
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

	it("runs global rules when globalOnly", async () => {
		const exit = await runAudit({
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
	beforeAll(async () => {
		await runBuildPlugin({ root: PLUGIN_CONSUMER });
	});

	it("validates explicit doc path", async () => {
		const exit = await runValidateChanged({
			root: FLAT_SKILL_ROOT,
			paths: ["docs/README.md"],
		});
		expect(exit).toBe(0);
	});

	it("fails when all paths are skipped code", async () => {
		const tsPath = join(FLAT_SKILL_ROOT, "src/example.ts");
		writeFileSync(tsPath, "export const n = 1;\n");
		try {
			const exit = await runValidateChanged({
				root: FLAT_SKILL_ROOT,
				paths: ["src/example.ts"],
			});
			expect(exit).toBe(1);
		} finally {
			unlinkSync(tsPath);
		}
	});

	it("passes mixed docs and skipped ts", async () => {
		const tsPath = join(FLAT_SKILL_ROOT, "src/example.ts");
		writeFileSync(tsPath, "export const n = 1;\n");
		try {
			const exit = await runValidateChanged({
				root: FLAT_SKILL_ROOT,
				paths: ["docs/README.md", "src/example.ts"],
			});
			expect(exit).toBe(0);
		} finally {
			unlinkSync(tsPath);
		}
	});

	it("fails skill-only paths without --base and points at audit skills", async () => {
		const exit = await runValidateChanged({
			root: FLAT_SKILL_ROOT,
			paths: ["multi/SKILL.md"],
		});
		expect(exit).toBe(1);
	});

	it("fails skill+unwired-policy paths as orphan policy (not wired by plugin globs)", async () => {
		const policyDir = join(FLAT_SKILL_ROOT, ".skeleton/plugins/example/policies");
		mkdirSync(policyDir, { recursive: true });
		const policyRel = ".skeleton/plugins/example/policies/_tmp-skill-policy.yaml";
		const policyAbs = join(FLAT_SKILL_ROOT, policyRel);
		writeFileSync(policyAbs, `name: tmp\nentries:\n  - id: a\n    pattern: foo\n    message: m\n`);
		const err = spyOn(console, "error").mockImplementation(() => {});
		try {
			const exit = await runValidateChanged({
				root: FLAT_SKILL_ROOT,
				paths: ["multi/SKILL.md", policyRel],
			});
			expect(exit).toBe(1);
			expect(err.mock.calls.flat().join("\n")).toMatch(/not referenced by any plugin policies/);
		} finally {
			err.mockRestore();
			unlinkSync(policyAbs);
			rmSync(join(FLAT_SKILL_ROOT, ".skeleton/plugins"), { recursive: true, force: true });
		}
	});

	it("fails when all explicit paths are missing on disk", async () => {
		const exit = await runValidateChanged({
			root: FLAT_SKILL_ROOT,
			paths: ["docs/does-not-exist.md"],
		});
		expect(exit).toBe(1);
	});

	it("schema-checks wired policy YAML then fail-closes without --base", async () => {
		const err = spyOn(console, "error").mockImplementation(() => {});
		try {
			const exit = await runValidateChanged({
				root: PLUGIN_CONSUMER,
				paths: [".skeleton/plugins/example/policies/sample-banned-phrase.yaml"],
			});
			expect(exit).toBe(1);
			expect(err.mock.calls.flat().join("\n")).toContain("audit docs");
		} finally {
			err.mockRestore();
		}
	});

	it("fail-closes wired policy YAML even when docs co-change (path-scoped is not prose coverage)", async () => {
		const err = spyOn(console, "error").mockImplementation(() => {});
		try {
			const exit = await runValidateChanged({
				root: PLUGIN_CONSUMER,
				paths: [".skeleton/plugins/example/policies/sample-banned-phrase.yaml", "docs/clean.md"],
			});
			expect(exit).toBe(1);
			expect(err.mock.calls.flat().join("\n")).toMatch(/full prose-policy pass|audit docs/);
		} finally {
			err.mockRestore();
		}
	});

	it("fails orphan .skeleton/policies YAML not exported by a plugin", async () => {
		const policyDir = join(PLUGIN_CONSUMER, ".skeleton/policies");
		mkdirSync(policyDir, { recursive: true });
		const policyRel = ".skeleton/policies/_tmp-shared.yaml";
		const policyAbs = join(PLUGIN_CONSUMER, policyRel);
		writeFileSync(
			policyAbs,
			`name: shared\nentries:\n  - id: a\n    pattern: foo\n    message: m\n`,
		);
		const err = spyOn(console, "error").mockImplementation(() => {});
		try {
			const exit = await runValidateChanged({
				root: PLUGIN_CONSUMER,
				paths: [policyRel, "docs/clean.md"],
			});
			expect(exit).toBe(1);
			expect(err.mock.calls.flat().join("\n")).toMatch(/not referenced by any plugin policies/);
		} finally {
			err.mockRestore();
			unlinkSync(policyAbs);
			rmSync(policyDir, { recursive: true, force: true });
		}
	});

	it("under --base, proves full docs prose for wired policy changes (no redirect)", async () => {
		const err = spyOn(console, "error").mockImplementation(() => {});
		const log = spyOn(console, "log").mockImplementation(() => {});
		try {
			const exit = await runValidateChanged({
				root: PLUGIN_CONSUMER,
				base: "HEAD",
				paths: [".skeleton/plugins/example/policies/sample-banned-phrase.yaml"],
			});
			expect(exit).toBe(1);
			const msg = [...err.mock.calls, ...log.mock.calls].flat().join("\n");
			expect(msg).not.toMatch(/need a full prose-policy pass/);
			expect(msg).toMatch(/fixture banned phrase|Doc audit failed|Audit failed/i);
		} finally {
			err.mockRestore();
			log.mockRestore();
		}
	});

	it("under --base, wired clean policy can pass validate when docs audit is green", async () => {
		const dir = mkdtempSync(join(tmpdir(), "skel-policy-base-"));
		mkdirSync(join(dir, ".skeleton/plugins/demo"), { recursive: true });
		mkdirSync(join(dir, "docs"), { recursive: true });
		writeFileSync(
			join(dir, ".skeleton/config.yaml"),
			`scan:\n  include: ["docs/**"]\n  exclude: []\n  banned: []\ndaysUntilStale: 180\nplugins:\n  - plugins/demo/demo.ts\n`,
		);
		writeFileSync(
			join(dir, ".skeleton/registry.md"),
			`<!-- doc-meta: owner=eng | last-reviewed=2099-01-01 -->\n\n| Topic | Path | Owner |\n| --- | --- | --- |\n| A | [a](../docs/a.md) | eng |\n`,
		);
		writeFileSync(
			join(dir, "docs/a.md"),
			`# A\n\n<!-- doc-meta: owner=eng | last-reviewed=2099-01-01 -->\n\n**Source of truth for** A.\n`,
		);
		writeFileSync(
			join(dir, ".skeleton/plugins/demo/demo.ts"),
			`export const rules = [];\nexport const policies = ["plugins/demo/policies/*.yaml"];\nexport default { rules, policies };\n`,
		);
		mkdirSync(join(dir, ".skeleton/plugins/demo/policies"), { recursive: true });
		const policyRel = ".skeleton/plugins/demo/policies/clean.yaml";
		writeFileSync(
			join(dir, policyRel),
			`name: clean\nentries:\n  - id: never\n    pattern: "ZZZ_NEVER_MATCH_POLICY_TOKEN"\n    message: "should not fire"\n`,
		);
		try {
			await runBuildPlugin({ root: dir });
			const exit = await runValidateChanged({
				root: dir,
				base: "HEAD",
				paths: [policyRel],
			});
			expect(exit).toBe(0);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("fails invalid plugin policy severity", async () => {
		const badPath = join(
			PLUGIN_CONSUMER,
			".skeleton/plugins/example/policies/_tmp-bad-severity.yaml",
		);
		writeFileSync(
			badPath,
			`name: bad\nentries:\n  - id: a\n    pattern: foo\n    message: m\n    severity: critical\n`,
		);
		try {
			const exit = await runValidateChanged({
				root: PLUGIN_CONSUMER,
				paths: [".skeleton/plugins/example/policies/_tmp-bad-severity.yaml"],
			});
			expect(exit).toBe(1);
		} finally {
			unlinkSync(badPath);
		}
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
