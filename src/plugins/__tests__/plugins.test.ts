import { describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../../audit/config/load.ts";
import { createContext } from "../../audit/core/context.ts";
import { type AuditSuite, assembleRules } from "../../audit/rules/index.ts";
import { runAudit } from "../../audit/run.ts";
import { parseBuildPluginArgs, runBuildPlugin, stampPathForMjs } from "../build.ts";
import { loadPlugins, normalizeExport } from "../load.ts";
import { resolveAbsolutePluginTsPath, resolvePluginTsPath } from "../paths.ts";

const CONSUMER = join(import.meta.dir, "../../audit/__tests__/fixtures/plugins/consumer");

describe("parseBuildPluginArgs", () => {
	it("parses --check and entry", () => {
		expect(parseBuildPluginArgs([])).toEqual({ check: false, entry: undefined });
		expect(parseBuildPluginArgs(["--check"])).toEqual({ check: true, entry: undefined });
		expect(parseBuildPluginArgs(["plugins/x.ts", "--check"])).toEqual({
			check: true,
			entry: "plugins/x.ts",
		});
	});

	it("fails closed on --check=value and unknown flags", () => {
		expect(() => parseBuildPluginArgs(["--check=true"])).toThrow(/boolean flag/);
		expect(() => parseBuildPluginArgs(["--force"])).toThrow(/unknown flag/);
	});
});

describe("assembleRules", () => {
	it("includes core prose-policy in docs and skills suites", () => {
		const { docs, skills, self } = assembleRules([]);
		expect(docs.some((r) => r.id === "prose-policy")).toBe(true);
		expect(skills.some((r) => r.id === "prose-policy")).toBe(true);
		expect(self.filter((r) => r.id === "prose-policy")).toHaveLength(1);
	});

	it("appends plugin rules to docs by default", () => {
		const pluginRule = {
			id: "plugin-demo",
			run: () => [],
		};
		const { docs, skills } = assembleRules([pluginRule]);
		expect(docs.some((r) => r.id === "plugin-demo")).toBe(true);
		expect(skills.some((r) => r.id === "plugin-demo")).toBe(false);
	});

	it("respects suites", () => {
		const pluginRule = {
			id: "plugin-skills",
			suites: ["skills"] as AuditSuite[],
			run: () => [],
		};
		const { docs, skills } = assembleRules([pluginRule]);
		expect(docs.some((r) => r.id === "plugin-skills")).toBe(false);
		expect(skills.some((r) => r.id === "plugin-skills")).toBe(true);
	});

	it("fails on duplicate rule ids", () => {
		expect(() => assembleRules([{ id: "links", run: () => [] }])).toThrow(/Duplicate/);
	});

	it("fails when suites is empty", () => {
		expect(() => assembleRules([{ id: "plugin-empty-suites", suites: [], run: () => [] }])).toThrow(
			/no known suite/,
		);
	});

	it("fails when suites are only unknown names", () => {
		expect(() =>
			assembleRules([
				{
					id: "plugin-self-suite",
					suites: ["self"] as unknown as AuditSuite[],
					run: () => [],
				},
			]),
		).toThrow(/no known suite/);
	});
});

describe("plugin load + build", () => {
	it("throws when .mjs is missing", async () => {
		const dir = join(tmpdir(), `skel-plugin-missing-${Date.now()}`);
		mkdirSync(join(dir, ".skeleton/plugins"), { recursive: true });
		writeFileSync(
			join(dir, ".skeleton/config.yaml"),
			`scan:\n  include: ["docs/**"]\n  exclude: []\n  banned: []\ndaysUntilStale: 180\nplugins:\n  - plugins/missing.ts\n`,
		);
		writeFileSync(join(dir, ".skeleton/plugins/missing.ts"), "export default { rules: [] };\n");
		try {
			const config = loadConfig(dir);
			await expect(loadPlugins(dir, config)).rejects.toThrow(/Plugin not built/);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("builds plugin and loads policies", async () => {
		const config = loadConfig(CONSUMER);
		await runBuildPlugin({ root: CONSUMER });
		expect(existsSync(join(CONSUMER, ".skeleton/plugins/example/example.mjs"))).toBe(true);
		const loaded = await loadPlugins(CONSUMER, config);
		expect(loaded.policies.length).toBeGreaterThan(0);
		expect(loaded.policies[0]?.name).toBe("sample-banned-phrase");
	});

	it("build-plugin --check fails when source content drifts (equal mtimes)", async () => {
		await runBuildPlugin({ root: CONSUMER });
		const ts = join(CONSUMER, ".skeleton/plugins/example/example.ts");
		const original = readFileSync(ts, "utf8");
		writeFileSync(ts, `${original}\n// content drift\n`);
		await expect(runBuildPlugin({ root: CONSUMER, check: true })).rejects.toThrow(/stale/);
		writeFileSync(ts, original);
		await runBuildPlugin({ root: CONSUMER });
		await expect(runBuildPlugin({ root: CONSUMER, check: true })).resolves.toBeDefined();
	});

	it("build-plugin --check fails when stamp is missing", async () => {
		await runBuildPlugin({ root: CONSUMER });
		const mjs = join(CONSUMER, ".skeleton/plugins/example/example.mjs");
		rmSync(stampPathForMjs(mjs), { force: true });
		await expect(runBuildPlugin({ root: CONSUMER, check: true })).rejects.toThrow(/stamp/);
		await runBuildPlugin({ root: CONSUMER });
	});

	it("build-plugin --check fails when local .js→.ts dep content drifts", async () => {
		const dir = join(tmpdir(), `skel-plugin-jsdep-${Date.now()}`);
		mkdirSync(join(dir, ".skeleton/plugins/multi"), { recursive: true });
		writeFileSync(
			join(dir, ".skeleton/config.yaml"),
			`scan:\n  include: ["docs/**"]\n  exclude: []\n  banned: []\ndaysUntilStale: 180\nplugins:\n  - plugins/multi/entry.ts\n`,
		);
		writeFileSync(join(dir, ".skeleton/plugins/multi/util.ts"), `export const marker = "util";\n`);
		writeFileSync(
			join(dir, ".skeleton/plugins/multi/entry.ts"),
			`import { marker } from "./util.js";\nexport default { rules: [], policies: undefined };\nvoid marker;\n`,
		);
		try {
			await runBuildPlugin({ root: dir });
			const util = join(dir, ".skeleton/plugins/multi/util.ts");
			writeFileSync(util, `export const marker = "util-changed";\n`);
			await expect(runBuildPlugin({ root: dir, check: true })).rejects.toThrow(/stale/);
			await runBuildPlugin({ root: dir });
			await expect(runBuildPlugin({ root: dir, check: true })).resolves.toBeDefined();
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("build-plugin --check fails when side-effect or dynamic local import drifts", async () => {
		const dir = join(tmpdir(), `skel-plugin-sidefx-${Date.now()}`);
		mkdirSync(join(dir, ".skeleton/plugins/side"), { recursive: true });
		writeFileSync(
			join(dir, ".skeleton/config.yaml"),
			`scan:\n  include: ["docs/**"]\n  exclude: []\n  banned: []\ndaysUntilStale: 180\nplugins:\n  - plugins/side/entry.ts\n`,
		);
		writeFileSync(join(dir, ".skeleton/plugins/side/side.ts"), `export const side = 1;\n`);
		writeFileSync(join(dir, ".skeleton/plugins/side/dyn.ts"), `export const dyn = 1;\n`);
		writeFileSync(
			join(dir, ".skeleton/plugins/side/entry.ts"),
			`import "./side.js";\nvoid import("./dyn.js");\nexport default { rules: [] };\n`,
		);
		try {
			await runBuildPlugin({ root: dir });
			writeFileSync(join(dir, ".skeleton/plugins/side/side.ts"), `export const side = 2;\n`);
			await expect(runBuildPlugin({ root: dir, check: true })).rejects.toThrow(/stale/);
			await runBuildPlugin({ root: dir });
			writeFileSync(join(dir, ".skeleton/plugins/side/dyn.ts"), `export const dyn = 2;\n`);
			await expect(runBuildPlugin({ root: dir, check: true })).rejects.toThrow(/stale/);
			await runBuildPlugin({ root: dir });
			await expect(runBuildPlugin({ root: dir, check: true })).resolves.toBeDefined();
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("build-plugin --check survives circular local imports", async () => {
		const dir = join(tmpdir(), `skel-plugin-cycle-${Date.now()}`);
		mkdirSync(join(dir, ".skeleton/plugins/cycle"), { recursive: true });
		writeFileSync(
			join(dir, ".skeleton/config.yaml"),
			`scan:\n  include: ["docs/**"]\n  exclude: []\n  banned: []\ndaysUntilStale: 180\nplugins:\n  - plugins/cycle/a.ts\n`,
		);
		writeFileSync(
			join(dir, ".skeleton/plugins/cycle/a.ts"),
			`import { b } from "./b.js";\nexport const a = 1;\nexport default { rules: [] };\nvoid b;\n`,
		);
		writeFileSync(
			join(dir, ".skeleton/plugins/cycle/b.ts"),
			`import { a } from "./a.js";\nexport const b = a;\n`,
		);
		try {
			await runBuildPlugin({ root: dir });
			await runBuildPlugin({ root: dir, check: true });
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("fails closed when declared policy globs match no YAML", async () => {
		const dir = join(tmpdir(), `skel-plugin-nopolicy-${Date.now()}`);
		mkdirSync(join(dir, ".skeleton/plugins"), { recursive: true });
		writeFileSync(
			join(dir, ".skeleton/config.yaml"),
			`scan:\n  include: ["docs/**"]\n  exclude: []\n  banned: []\ndaysUntilStale: 180\nplugins:\n  - plugins/empty-pol.ts\n`,
		);
		writeFileSync(
			join(dir, ".skeleton/plugins/empty-pol.ts"),
			`export default { rules: [], policies: ["plugins/missing/*.yaml"] };\n`,
		);
		try {
			await runBuildPlugin({ root: dir });
			const config = loadConfig(dir);
			await expect(loadPlugins(dir, config)).rejects.toThrow(/matched no YAML/);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("bare audit skills catches excluded skill-scoped prose hits", async () => {
		const dir = join(tmpdir(), `skel-skills-exclude-bare-${Date.now()}`);
		mkdirSync(join(dir, ".skeleton/plugins/example/policies"), { recursive: true });
		mkdirSync(join(dir, ".claude/skills/foo"), { recursive: true });
		mkdirSync(join(dir, "docs"), { recursive: true });
		writeFileSync(
			join(dir, ".skeleton/config.yaml"),
			`scan:\n  include: ["docs/**"]\n  exclude: [".claude/**"]\n  banned: []\ndaysUntilStale: 180\nplugins:\n  - plugins/example/example.ts\n`,
		);
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
		try {
			await runBuildPlugin({ root: dir });
			const bare = await runAudit({
				suite: "skills",
				strict: false,
				json: false,
				paths: [],
				only: new Set(["prose-policy"]),
				root: dir,
			});
			expect(bare).toBe(1);
			const scoped = await runAudit({
				suite: "skills",
				strict: false,
				json: false,
				paths: [".claude/skills/foo/SKILL.md"],
				only: new Set(["prose-policy"]),
				root: dir,
			});
			expect(scoped).toBe(1);
			const scopedDir = await runAudit({
				suite: "skills",
				strict: false,
				json: false,
				paths: [".claude/skills/foo"],
				only: new Set(["prose-policy"]),
				root: dir,
				pathScopedOnly: true,
			});
			expect(scopedDir).toBe(1);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("bare audit skills ignores foreign locked skill prose hits", async () => {
		const dir = join(tmpdir(), `skel-skills-foreign-bare-${Date.now()}`);
		mkdirSync(join(dir, ".skeleton/plugins/example/policies"), { recursive: true });
		mkdirSync(join(dir, ".claude/skills/foreign"), { recursive: true });
		mkdirSync(join(dir, ".claude/skills/mine"), { recursive: true });
		mkdirSync(join(dir, "docs"), { recursive: true });
		writeFileSync(
			join(dir, ".skeleton/config.yaml"),
			`scan:\n  include: ["docs/**"]\n  exclude: [".claude/**"]\n  banned: []\ndaysUntilStale: 180\nplugins:\n  - plugins/example/example.ts\n`,
		);
		writeFileSync(
			join(dir, ".skeleton/plugins/example/example.ts"),
			`export default { rules: [], policies: ["plugins/example/policies/*.yaml"] };\n`,
		);
		writeFileSync(
			join(dir, ".skeleton/plugins/example/policies/banned.yaml"),
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
		writeFileSync(join(dir, "docs/a.md"), "# A\n");
		try {
			await runBuildPlugin({ root: dir });
			const bare = await runAudit({
				suite: "skills",
				strict: false,
				json: false,
				paths: [],
				only: new Set(["prose-policy"]),
				root: dir,
			});
			expect(bare).toBe(0);

			writeFileSync(
				join(dir, ".claude/skills/mine/SKILL.md"),
				"---\nname: mine\ndescription: x\n---\n\nHUB_BANNED_TOKEN\n",
			);
			const bareOwned = await runAudit({
				suite: "skills",
				strict: false,
				json: false,
				paths: [],
				only: new Set(["prose-policy"]),
				root: dir,
			});
			expect(bareOwned).toBe(1);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("path-scoped audit skills ignores foreign locked skill prose hits", async () => {
		const dir = join(tmpdir(), `skel-skills-foreign-paths-${Date.now()}`);
		mkdirSync(join(dir, ".skeleton/plugins/example/policies"), { recursive: true });
		mkdirSync(join(dir, ".claude/skills/foreign"), { recursive: true });
		mkdirSync(join(dir, "docs"), { recursive: true });
		writeFileSync(
			join(dir, ".skeleton/config.yaml"),
			`scan:\n  include: ["docs/**"]\n  exclude: [".claude/**"]\n  banned: []\ndaysUntilStale: 180\nplugins:\n  - plugins/example/example.ts\n`,
		);
		writeFileSync(
			join(dir, ".skeleton/plugins/example/example.ts"),
			`export default { rules: [], policies: ["plugins/example/policies/*.yaml"] };\n`,
		);
		writeFileSync(
			join(dir, ".skeleton/plugins/example/policies/banned.yaml"),
			`name: skill-banned\nentries:\n  - id: hub\n    scope: ".claude/skills/**"\n    pattern: HUB_BANNED_TOKEN\n    message: no hub token\n`,
		);
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
		writeFileSync(join(dir, "docs/a.md"), "# A\n");
		try {
			await runBuildPlugin({ root: dir });
			const scoped = await runAudit({
				suite: "skills",
				strict: false,
				json: false,
				paths: [".claude/skills/foreign/SKILL.md"],
				only: new Set(["prose-policy"]),
				root: dir,
			});
			expect(scoped).toBe(0);

			const ctx = createContext({
				root: dir,
				paths: [".claude/skills/foreign/SKILL.md"],
			});
			expect(
				ctx.files.some((abs) =>
					abs.replaceAll("\\", "/").endsWith(".claude/skills/foreign/SKILL.md"),
				),
			).toBe(false);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("surfaces scoped prose-policy hits via runAudit", async () => {
		await runBuildPlugin({ root: CONSUMER });
		const exit = await runAudit({
			suite: "docs",
			strict: false,
			json: true,
			paths: [],
			only: new Set(["prose-policy"]),
			root: CONSUMER,
		});
		expect(exit).toBe(1);
	});

	it("--only=prose-policy filters and path-scope still runs prose", async () => {
		await runBuildPlugin({ root: CONSUMER });
		const exit = await runAudit({
			suite: "docs",
			strict: false,
			json: true,
			paths: ["src/audit/__tests__/fixtures/plugins/scoped-hit.md"],
			only: new Set(["prose-policy"]),
			root: CONSUMER,
			pathScopedOnly: true,
		});
		expect(exit).toBe(1);
	});

	it("skills suite path-scoped prose-policy hits SKILL.md", async () => {
		const dir = join(tmpdir(), `skel-skill-prose-${Date.now()}`);
		mkdirSync(join(dir, ".skeleton/plugins/example/policies"), { recursive: true });
		mkdirSync(join(dir, "skill-a"), { recursive: true });
		writeFileSync(
			join(dir, ".skeleton/config.yaml"),
			`scan:\n  include: ["docs/**"]\n  exclude: []\n  banned: []\ndaysUntilStale: 180\nplugins:\n  - plugins/example/example.ts\n`,
		);
		writeFileSync(join(dir, ".skeleton/registry.md"), "# Registry\n");
		writeFileSync(
			join(dir, ".skeleton/plugins/example/example.ts"),
			`export default { rules: [], policies: ["plugins/example/policies/*.yaml"] };\n`,
		);
		writeFileSync(
			join(dir, ".skeleton/plugins/example/policies/banned.yaml"),
			`name: skill-banned\nentries:\n  - id: hub\n    pattern: HUB_BANNED_TOKEN\n    message: no hub token\n`,
		);
		writeFileSync(
			join(dir, "skill-a/SKILL.md"),
			"---\nname: skill-a\ndescription: x\n---\n\nHUB_BANNED_TOKEN\n",
		);
		try {
			await runBuildPlugin({ root: dir });
			const exit = await runAudit({
				suite: "skills",
				strict: false,
				json: true,
				paths: ["skill-a/SKILL.md"],
				only: new Set(["prose-policy"]),
				root: dir,
				pathScopedOnly: true,
			});
			expect(exit).toBe(1);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("no plugins → no prose hits on flat fixture", async () => {
		const flat = join(import.meta.dir, "../../audit/__tests__/fixtures/flat-skill-root");
		const exit = await runAudit({
			suite: "docs",
			strict: false,
			json: true,
			paths: [],
			only: new Set(["prose-policy"]),
			root: flat,
		});
		expect(exit).toBe(0);
	});
});

describe("plugin module export validation", () => {
	it("built mjs exports policies array", async () => {
		await runBuildPlugin({ root: CONSUMER });
		const mjs = join(CONSUMER, ".skeleton/plugins/example/example.mjs");
		const content = readFileSync(mjs, "utf8");
		expect(content).toContain("policies");
	});

	it("rejects non-array policies exports", () => {
		expect(() =>
			normalizeExport({
				rules: [],
				policies: "plugins/**/*.yaml",
			}),
		).toThrow(/policies must be string\[\]/);
	});

	it("fills named policies when default omits them", () => {
		const normalized = normalizeExport({
			policies: ["plugins/example/policies/*.yaml"],
			default: { rules: [] },
		});
		expect(normalized.policies).toEqual(["plugins/example/policies/*.yaml"]);
		expect(normalized.rules).toEqual([]);
	});

	it("fails closed when default and named policies disagree", () => {
		expect(() =>
			normalizeExport({
				policies: ["plugins/a/*.yaml"],
				default: { rules: [], policies: ["plugins/b/*.yaml"] },
			}),
		).toThrow(/disagree on policies/);
	});

	it("accepts matching default and named policies", () => {
		const globs = ["plugins/example/policies/*.yaml"];
		const normalized = normalizeExport({
			policies: globs,
			default: { rules: [], policies: globs },
		});
		expect(normalized.policies).toEqual(globs);
	});

	it("fails closed when default and named rules disagree", () => {
		const named = { id: "named", run: () => [] };
		expect(() =>
			normalizeExport({
				rules: [named],
				default: { rules: [], policies: [] },
			}),
		).toThrow(/disagree on rules/);
	});

	it("accepts matching default and named rules", () => {
		const rule = { id: "shared", run: () => [] };
		const normalized = normalizeExport({
			rules: [rule],
			default: { rules: [rule], policies: [] },
		});
		expect(normalized.rules).toEqual([rule]);
	});
});

describe("plugin path containment", () => {
	it("rejects .. and absolute plugin entries", () => {
		const root = "/tmp/skel-root";
		expect(() => resolvePluginTsPath(root, "../evil.ts")).toThrow(/under \.skeleton/);
		expect(() => resolvePluginTsPath(root, "/tmp/x.ts")).toThrow(/relative to \.skeleton/);
	});

	it("rejects entries that resolve to .skeleton/ itself", () => {
		const root = "/tmp/skel-root";
		for (const entry of [".", "./", ".skeleton/", ".skeleton/."]) {
			expect(() => resolvePluginTsPath(root, entry)).toThrow(/under \.skeleton/);
		}
	});

	it("rejects non-.ts plugin entries under .skeleton/", () => {
		const root = "/tmp/skel-root";
		expect(() => resolvePluginTsPath(root, "plugins/example")).toThrow(/\.ts file/);
	});

	it("rejects policy globs that escape .skeleton", async () => {
		const dir = join(tmpdir(), `skel-plugin-escape-${Date.now()}`);
		mkdirSync(join(dir, ".skeleton/plugins"), { recursive: true });
		writeFileSync(
			join(dir, ".skeleton/config.yaml"),
			`scan:\n  include: ["docs/**"]\n  exclude: []\n  banned: []\ndaysUntilStale: 180\nplugins:\n  - plugins/escape.ts\n`,
		);
		writeFileSync(
			join(dir, ".skeleton/plugins/escape.ts"),
			`export default { rules: [], policies: ["../../**/*.yaml"] };\n`,
		);
		try {
			await runBuildPlugin({ root: dir });
			const config = loadConfig(dir);
			await expect(loadPlugins(dir, config)).rejects.toThrow(/under \.skeleton/);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("rejects directory symlink escapes under .skeleton/", () => {
		const dir = join(tmpdir(), `skel-plugin-symlink-${Date.now()}`);
		mkdirSync(join(dir, ".skeleton/plugins"), { recursive: true });
		mkdirSync(join(dir, "src"), { recursive: true });
		writeFileSync(join(dir, "src/index.ts"), "export const keep = true;\n");
		symlinkSync(dir, join(dir, ".skeleton/plugins/shadow"));
		try {
			expect(() => resolvePluginTsPath(dir, "plugins/shadow/src/index.ts")).toThrow(
				/under \.skeleton/,
			);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("rejects nested missing dirs under a symlink escape", () => {
		const dir = join(tmpdir(), `skel-plugin-nested-symlink-${Date.now()}`);
		mkdirSync(join(dir, ".skeleton"), { recursive: true });
		mkdirSync(join(dir, "outside"), { recursive: true });
		symlinkSync(join(dir, "outside"), join(dir, ".skeleton/link"));
		try {
			expect(() => resolvePluginTsPath(dir, "link/newdir/x.ts")).toThrow(/under \.skeleton/);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("rejects absolute entries that escape via directory symlink", async () => {
		const dir = join(tmpdir(), `skel-plugin-abs-symlink-${Date.now()}`);
		mkdirSync(join(dir, ".skeleton"), { recursive: true });
		mkdirSync(join(dir, "outside"), { recursive: true });
		writeFileSync(join(dir, "outside/x.ts"), "export default { rules: [] };\n");
		writeFileSync(
			join(dir, ".skeleton/config.yaml"),
			`scan:\n  include: ["docs/**"]\n  exclude: []\n  banned: []\ndaysUntilStale: 180\n`,
		);
		symlinkSync(join(dir, "outside"), join(dir, ".skeleton/plugins"));
		const absEntry = join(dir, ".skeleton/plugins/x.ts");
		try {
			expect(() => resolveAbsolutePluginTsPath(dir, absEntry)).toThrow(/under \.skeleton/);
			await expect(runBuildPlugin({ root: dir, entry: absEntry })).rejects.toThrow(
				/under \.skeleton/,
			);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
