import { beforeAll, describe, expect, it, spyOn } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { attestDocuments } from "../../audit/core/review-proof.ts";
import { runAudit } from "../../audit/run.ts";
import { checkCatalog, runCatalogCli, writeCatalog } from "../../catalog.ts";
import { resolveCustomize } from "../../customize/resolve.ts";
import { runBuildPlugin } from "../../plugins/build.ts";
import {
	codeValidationHint,
	evaluateValidateChanged,
	runValidateChanged,
} from "../../validate/changed.ts";

const FIXTURES = join(import.meta.dir, "../../audit/__tests__/fixtures");
const NESTED_SKILLS_CUSTOMIZE = join(FIXTURES, "nested-skills-customize");
const FLAT_SKILL_ROOT = join(FIXTURES, "flat-skill-root");
const PLUGIN_CONSUMER = join(FIXTURES, "plugins/consumer");

describe("catalog", () => {
	it("can fail closed when a strict check finds no generated catalog", () => {
		const dir = mkdtempSync(join(tmpdir(), "skel-catalog-strict-"));
		try {
			mkdirSync(join(dir, "docs"), { recursive: true });
			writeFileSync(
				join(dir, "skeleton.toml"),
				'daysUntilStale = 365\n[scan]\ninclude = ["docs/**"]\nexclude = []\n',
			);
			expect(runCatalogCli({ root: dir, check: true })).toBe(0);
			expect(runCatalogCli({ root: dir, check: true, strict: true })).toBe(1);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("builds catalog from SSOT-bearing files", () => {
		const dir = mkdtempSync(join(tmpdir(), "skel-catalog-"));
		try {
			mkdirSync(join(dir, "docs"), { recursive: true });
			writeFileSync(
				join(dir, "skeleton.toml"),
				`daysUntilStale = 365

[scan]
include = ["docs/**"]
exclude = []
`,
			);
			writeFileSync(
				join(dir, "docs/a.md"),
				"<!-- source-of-truth: Alpha topic -->\n\nAlpha body with topic words.\n",
			);
			const written = writeCatalog(dir);
			expect(written.entries.length).toBe(1);
			expect(written.entries[0]?.summary).toBe("Alpha topic");
			const check = checkCatalog(dir);
			expect(check.ok).toBe(true);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
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
		expect(exit).toBe(1);
	});

	it("fails when --only names no loaded rule", async () => {
		const exit = await runAudit({
			suite: "docs",
			strict: false,
			json: false,
			paths: [],
			only: new Set(["does-not-exist"]),
			root: FLAT_SKILL_ROOT,
		});
		expect(exit).toBe(1);
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

	it("keeps validation evaluation internal while routing nested audits", async () => {
		const log = spyOn(console, "log").mockImplementation(() => {});
		const error = spyOn(console, "error").mockImplementation(() => {});
		try {
			const result = await evaluateValidateChanged({
				root: FLAT_SKILL_ROOT,
				paths: ["docs/README.md"],
			});
			expect(result).toMatchObject({
				classification: { docs: ["docs/README.md"] },
			});
			expect(result.audits).toHaveLength(1);
			expect(log).not.toHaveBeenCalled();
			expect(error).not.toHaveBeenCalled();
		} finally {
			log.mockRestore();
			error.mockRestore();
		}
	});

	it("prints agent-readable dependency impact context", async () => {
		const lines: string[] = [];
		const log = spyOn(console, "log").mockImplementation((value) => lines.push(String(value)));
		try {
			const exit = await runValidateChanged({ root: FLAT_SKILL_ROOT, paths: ["docs/README.md"] });
			expect(exit).toBe(0);
			expect(lines.some((line) => line.startsWith("Doc audit passed"))).toBe(true);
			expect(lines.some((line) => line.startsWith("validate changed passed"))).toBe(true);
		} finally {
			log.mockRestore();
		}
	});

	it("fails when all paths are skipped code", async () => {
		const tsPath = join(FLAT_SKILL_ROOT, "src/example.ts");
		mkdirSync(dirname(tsPath), { recursive: true });
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

	it("discovers and audits documents impacted by changed review dependencies", async () => {
		const root = mkdtempSync(join(tmpdir(), "skel-code-impact-"));
		try {
			mkdirSync(join(root, "docs"), { recursive: true });
			mkdirSync(join(root, "src"), { recursive: true });
			writeFileSync(
				join(root, "skeleton.toml"),
				`daysUntilStale = 365
[scan]
include = ["docs/**"]
exclude = []
[reviewProof]
mode = "hash"
`,
			);
			writeFileSync(join(root, "src/example.ts"), "export const runThing = 1;\n");
			writeFileSync(
				join(root, "docs/example.md"),
				`# Example

<!-- source-of-truth: example runThing behavior -->

<!-- doc-meta: owner=eng | last-reviewed=2026-08-19 -->

<!-- review-deps: paths=src/example.ts -->

The runThing export provides the example behavior.
`,
			);
			attestDocuments({ root, paths: ["docs/example.md"], reviewedAt: "2026-08-19" });
			writeFileSync(join(root, "src/example.ts"), "export const runThing = 2;\n");

			const result = await evaluateValidateChanged({ root, paths: ["src/example.ts"] });
			expect(result.classification.code).toEqual(["src/example.ts"]);
			expect(result.impactedDocuments).toEqual([
				{
					path: "docs/example.md",
					reviewDependencies: ["src/example.ts"],
					reasons: [
						{
							kind: "changed-review-dependency",
							dependency: "src/example.ts",
							target: "src/example.ts",
						},
					],
				},
			]);
			expect(result.classification.docs).toContain("docs/example.md");
			expect(result.exitCode).toBe(1);
			expect(
				result.audits
					.flatMap((audit) => audit.diagnostics)
					.some((item) => item.code === "review-dependency-changed"),
			).toBe(true);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("discovers documents whose review dependencies name package.json", async () => {
		const root = mkdtempSync(join(tmpdir(), "skel-package-impact-"));
		try {
			mkdirSync(join(root, "docs"), { recursive: true });
			writeFileSync(
				join(root, "skeleton.toml"),
				'daysUntilStale = 365\n[scan]\ninclude = ["docs/**"]\nexclude = []\n',
			);
			writeFileSync(join(root, "package.json"), '{"scripts":{"commands":"old"}}\n');
			writeFileSync(
				join(root, "docs/commands.md"),
				`# Commands

<!-- source-of-truth: project command documentation -->
<!-- doc-meta: owner=eng | last-reviewed=2026-08-24 -->
<!-- review-deps: paths=package.json -->

Run the project commands through the package scripts.
`,
			);

			const result = await evaluateValidateChanged({ root, paths: ["package.json"] });
			expect(result.impactedDocuments).toEqual([
				{
					path: "docs/commands.md",
					reviewDependencies: ["package.json"],
					reasons: [
						{
							kind: "changed-review-dependency",
							dependency: "package.json",
							target: "package.json",
						},
					],
				},
			]);
			expect(result.classification.docs).toContain("docs/commands.md");
			const lines: string[] = [];
			const log = spyOn(console, "log").mockImplementation((line) => lines.push(String(line)));
			try {
				expect(await runValidateChanged({ root, paths: ["package.json"] })).toBe(1);
				expect(lines).toContain(
					"validate changed: docs/commands.md requires review (dependency package.json matched package.json)",
				);
			} finally {
				log.mockRestore();
			}
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("fails closed on changed dependencies when hash review proof is not enabled", async () => {
		const root = mkdtempSync(join(tmpdir(), "skel-date-impact-"));
		try {
			mkdirSync(join(root, "docs"), { recursive: true });
			mkdirSync(join(root, "src"), { recursive: true });
			writeFileSync(
				join(root, "skeleton.toml"),
				'daysUntilStale = 365\n[scan]\ninclude = ["docs/**"]\nexclude = []\n',
			);
			writeFileSync(join(root, "src/example.ts"), "export const runThing = 2;\n");
			writeFileSync(
				join(root, "docs/example.md"),
				`# Example

<!-- source-of-truth: example runThing behavior -->
<!-- doc-meta: owner=eng | last-reviewed=2026-08-01 -->
<!-- review-deps: paths=src/example.ts -->

The runThing export provides the example behavior.
`,
			);

			const result = await evaluateValidateChanged({ root, paths: ["src/example.ts"] });
			expect(result.exitCode).toBe(1);
			expect(result.diagnostics).toContainEqual(
				expect.objectContaining({ code: "impacted-document-review-required" }),
			);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("under --base, all-skipped code does not fail-closed before global rules", async () => {
		const tsPath = join(FLAT_SKILL_ROOT, "src/example.ts");
		mkdirSync(dirname(tsPath), { recursive: true });
		writeFileSync(tsPath, "export const n = 1;\n");
		const lines: string[] = [];
		const capture = (msg?: unknown, ...rest: unknown[]) => {
			lines.push([msg, ...rest].map(String).join(" "));
		};
		const errSpy = spyOn(console, "error").mockImplementation(capture);
		const logSpy = spyOn(console, "log").mockImplementation(capture);
		try {
			await runValidateChanged({
				root: FLAT_SKILL_ROOT,
				paths: ["src/example.ts"],
				base: "HEAD",
			});
			const joined = lines.join("\n");
			expect(joined.includes("all paths were skipped")).toBe(false);
			expect(joined.includes("Self audit")).toBe(true);
		} finally {
			errSpy.mockRestore();
			logSpy.mockRestore();
			unlinkSync(tsPath);
		}
	});

	it("passes mixed docs and skipped ts", async () => {
		const tsPath = join(FLAT_SKILL_ROOT, "src/example.ts");
		mkdirSync(dirname(tsPath), { recursive: true });
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
		const err = spyOn(console, "error").mockImplementation(() => {});
		try {
			const exit = await runValidateChanged({
				root: FLAT_SKILL_ROOT,
				paths: ["multi/SKILL.md"],
			});
			expect(exit).toBe(1);
			const msg = err.mock.calls.flat().join("\n");
			expect(msg).toContain("audit skills");
			expect(msg).toContain("excluded skill trees still need audit skills");
			expect(msg).not.toMatch(/Or:\s+skeleton audit self/);
		} finally {
			err.mockRestore();
		}
	});

	it("fails docs+owned-skill mixes without --base (path-scoped skills are not coverage)", async () => {
		const err = spyOn(console, "error").mockImplementation(() => {});
		const log = spyOn(console, "log").mockImplementation(() => {});
		try {
			const exit = await runValidateChanged({
				root: FLAT_SKILL_ROOT,
				paths: ["docs/README.md", "multi/SKILL.md"],
			});
			expect(exit).toBe(1);
			const msg = [...err.mock.calls, ...log.mock.calls].flat().join("\n");
			expect(msg).toContain("audit skills");
			expect(msg).toMatch(/skill paths need the full skills suite/i);
		} finally {
			err.mockRestore();
			log.mockRestore();
		}
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
			expect(err.mock.calls.flat().join("\n")).toContain("audit skills");
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
			expect(err.mock.calls.flat().join("\n")).toContain("audit skills");
		} finally {
			err.mockRestore();
		}
	});

	it("fail-closes ./prefixed wired policy paths the same as plain .skeleton/ paths", async () => {
		const err = spyOn(console, "error").mockImplementation(() => {});
		try {
			const exit = await runValidateChanged({
				root: PLUGIN_CONSUMER,
				paths: [
					"./.skeleton/plugins/example/policies/sample-banned-phrase.yaml",
					"./docs/clean.md",
				],
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

	it("under --base, path-scoped skills still audit excluded .claude skills", async () => {
		const dir = mkdtempSync(join(tmpdir(), "skel-skill-exclude-"));
		mkdirSync(join(dir, ".skeleton/plugins/example/policies"), { recursive: true });
		mkdirSync(join(dir, ".claude/skills/foo"), { recursive: true });
		mkdirSync(join(dir, "docs"), { recursive: true });
		writeFileSync(
			join(dir, ".skeleton/config.yaml"),
			`scan:\n  include: ["docs/**"]\n  exclude: [".claude/**"]\ndaysUntilStale: 180\nplugins:\n  - plugins/example/example.ts\n`,
		);
		writeFileSync(join(dir, ".skeleton/registry.md"), "# Registry\n");
		writeFileSync(
			join(dir, ".skeleton/plugins/example/example.ts"),
			`export default { rules: [], policies: ["plugins/example/policies/*.yaml"] };\n`,
		);
		writeFileSync(
			join(dir, ".skeleton/plugins/example/policies/banned.yaml"),
			`name: skill-banned\nentries:\n  - id: hub\n    scope: ".claude/skills/**"\n    pattern: HUB_BANNED_TOKEN\n    message: no hub token\n`,
		);
		writeFileSync(
			join(dir, ".claude/skills/foo/SKILL.md"),
			"---\nname: foo\ndescription: x\n---\n\nHUB_BANNED_TOKEN\n",
		);
		writeFileSync(join(dir, "docs/a.md"), "# A\n");
		const err = spyOn(console, "error").mockImplementation(() => {});
		const log = spyOn(console, "log").mockImplementation(() => {});
		try {
			await runBuildPlugin({ root: dir });
			const exit = await runValidateChanged({
				root: dir,
				base: "HEAD",
				paths: [".claude/skills/foo/SKILL.md"],
			});
			expect(exit).toBe(1);
			const msg = [...err.mock.calls, ...log.mock.calls].flat().join("\n");
			expect(msg).toMatch(/no hub token|Skill index audit failed|Audit failed/i);
		} finally {
			err.mockRestore();
			log.mockRestore();
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("under --base, policy-only prove fails on excluded skill-scoped prose hits", async () => {
		const dir = mkdtempSync(join(tmpdir(), "skel-policy-only-skill-"));
		mkdirSync(join(dir, ".skeleton/plugins/example/policies"), { recursive: true });
		mkdirSync(join(dir, ".claude/skills/foo"), { recursive: true });
		mkdirSync(join(dir, "docs"), { recursive: true });
		writeFileSync(
			join(dir, ".skeleton/config.yaml"),
			`scan:\n  include: ["docs/**"]\n  exclude: [".claude/**"]\ndaysUntilStale: 180\nplugins:\n  - plugins/example/example.ts\n`,
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
			join(dir, ".skeleton/plugins/example/example.ts"),
			`export default { rules: [], policies: ["plugins/example/policies/*.yaml"] };\n`,
		);
		const policyRel = ".skeleton/plugins/example/policies/banned.yaml";
		writeFileSync(
			join(dir, policyRel),
			`name: skill-banned\nentries:\n  - id: hub\n    scope: ".claude/skills/**"\n    pattern: HUB_BANNED_TOKEN\n    message: no hub token\n`,
		);
		writeFileSync(
			join(dir, ".claude/skills/foo/SKILL.md"),
			"---\nname: foo\ndescription: x\n---\n\nHUB_BANNED_TOKEN\n",
		);
		const err = spyOn(console, "error").mockImplementation(() => {});
		const log = spyOn(console, "log").mockImplementation(() => {});
		try {
			await runBuildPlugin({ root: dir });
			const exit = await runValidateChanged({
				root: dir,
				base: "HEAD",
				paths: [policyRel],
			});
			expect(exit).toBe(1);
			const msg = [...err.mock.calls, ...log.mock.calls].flat().join("\n");
			expect(msg).toMatch(/no hub token|Skill index audit failed|Audit failed/i);
		} finally {
			err.mockRestore();
			log.mockRestore();
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("under --base, policy-only prove fails on excluded skill reference prose hits", async () => {
		const dir = mkdtempSync(join(tmpdir(), "skel-policy-ref-skill-"));
		mkdirSync(join(dir, ".skeleton/plugins/example/policies"), { recursive: true });
		mkdirSync(join(dir, ".claude/skills/foo/references"), { recursive: true });
		mkdirSync(join(dir, "docs"), { recursive: true });
		writeFileSync(
			join(dir, ".skeleton/config.yaml"),
			`scan:\n  include: ["docs/**"]\n  exclude: [".claude/**"]\ndaysUntilStale: 180\nplugins:\n  - plugins/example/example.ts\n`,
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
			join(dir, ".skeleton/plugins/example/example.ts"),
			`export default { rules: [], policies: ["plugins/example/policies/*.yaml"] };\n`,
		);
		const policyRel = ".skeleton/plugins/example/policies/banned.yaml";
		writeFileSync(
			join(dir, policyRel),
			`name: skill-banned\nentries:\n  - id: hub\n    scope: ".claude/skills/**"\n    pattern: HUB_BANNED_TOKEN\n    message: no hub token\n`,
		);
		writeFileSync(
			join(dir, ".claude/skills/foo/SKILL.md"),
			"---\nname: foo\ndescription: x\n---\n\nclean body\n",
		);
		writeFileSync(join(dir, ".claude/skills/foo/references/note.md"), "HUB_BANNED_TOKEN\n");
		const err = spyOn(console, "error").mockImplementation(() => {});
		const log = spyOn(console, "log").mockImplementation(() => {});
		try {
			await runBuildPlugin({ root: dir });
			const exit = await runValidateChanged({
				root: dir,
				base: "HEAD",
				paths: [policyRel],
			});
			expect(exit).toBe(1);
			const msg = [...err.mock.calls, ...log.mock.calls].flat().join("\n");
			expect(msg).toMatch(/no hub token|Skill index audit failed|Audit failed/i);
		} finally {
			err.mockRestore();
			log.mockRestore();
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("under --base, wired clean policy can pass validate when docs audit is green", async () => {
		const dir = mkdtempSync(join(tmpdir(), "skel-policy-base-"));
		mkdirSync(join(dir, ".skeleton/plugins/demo"), { recursive: true });
		mkdirSync(join(dir, "docs"), { recursive: true });
		writeFileSync(
			join(dir, ".skeleton/config.yaml"),
			`scan:\n  include: ["docs/**"]\n  exclude: []\ndaysUntilStale: 180\nplugins:\n  - plugins/demo/demo.ts\n`,
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

	it("skips foreign locked skill paths in validate changed", async () => {
		const dir = mkdtempSync(join(tmpdir(), "skel-foreign-skip-"));
		mkdirSync(join(dir, ".claude/skills/foreign"), { recursive: true });
		mkdirSync(join(dir, ".skeleton"), { recursive: true });
		mkdirSync(join(dir, "docs"), { recursive: true });
		writeFileSync(
			join(dir, ".skeleton/config.yaml"),
			`scan:\n  include: ["docs/**"]\n  exclude: [".claude/**"]\ndaysUntilStale: 180\n`,
		);
		writeFileSync(join(dir, ".skeleton/registry.md"), "# Registry\n");
		writeFileSync(
			join(dir, ".claude/skills/foreign/SKILL.md"),
			"---\nname: foreign\ndescription: x\n---\n\nHUB_BANNED_TOKEN\n",
		);
		writeFileSync(
			join(dir, "skills-lock.json"),
			JSON.stringify({
				version: 1,
				skills: {
					foreign: { source: "org/toolbox", sourceType: "github" },
				},
			}),
		);
		const log = spyOn(console, "log").mockImplementation(() => {});
		const err = spyOn(console, "error").mockImplementation(() => {});
		try {
			const exit = await runValidateChanged({
				root: dir,
				paths: [".claude/skills/foreign/SKILL.md"],
			});
			expect(exit).toBe(0);
			const msg = [...err.mock.calls, ...log.mock.calls].flat().join("\n");
			expect(msg).toMatch(/skipping foreign skill|foreign skill/);
		} finally {
			err.mockRestore();
			log.mockRestore();
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("under --base, policy prove ignores foreign locked skill prose hits", async () => {
		const dir = mkdtempSync(join(tmpdir(), "skel-policy-foreign-"));
		mkdirSync(join(dir, ".skeleton/plugins/example/policies"), { recursive: true });
		mkdirSync(join(dir, ".claude/skills/foreign"), { recursive: true });
		mkdirSync(join(dir, ".claude/skills/mine"), { recursive: true });
		mkdirSync(join(dir, "docs"), { recursive: true });
		writeFileSync(
			join(dir, ".skeleton/config.yaml"),
			`scan:\n  include: ["docs/**"]\n  exclude: [".claude/**"]\ndaysUntilStale: 180\nplugins:\n  - plugins/example/example.ts\n`,
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
			join(dir, ".skeleton/plugins/example/example.ts"),
			`export default { rules: [], policies: ["plugins/example/policies/*.yaml"] };\n`,
		);
		const policyRel = ".skeleton/plugins/example/policies/banned.yaml";
		writeFileSync(
			join(dir, policyRel),
			`name: skill-banned\nentries:\n  - id: hub\n    scope: ".claude/skills/**"\n    pattern: HUB_BANNED_TOKEN\n    message: no hub token\n`,
		);
		writeFileSync(
			join(dir, ".claude/skills/foreign/SKILL.md"),
			"---\nname: foreign\ndescription: x\n---\n\nHUB_BANNED_TOKEN\n",
		);
		writeFileSync(
			join(dir, ".claude/skills/mine/SKILL.md"),
			"---\nname: mine\ndescription: x\n---\n\nclean\n",
		);
		writeFileSync(
			join(dir, "skills-lock.json"),
			JSON.stringify({
				version: 1,
				skills: {
					foreign: { source: "org/toolbox", sourceType: "github" },
				},
			}),
		);
		const err = spyOn(console, "error").mockImplementation(() => {});
		const log = spyOn(console, "log").mockImplementation(() => {});
		try {
			await runBuildPlugin({ root: dir });
			const exit = await runValidateChanged({
				root: dir,
				base: "HEAD",
				paths: [policyRel],
			});
			expect(exit).toBe(0);
		} finally {
			err.mockRestore();
			log.mockRestore();
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
