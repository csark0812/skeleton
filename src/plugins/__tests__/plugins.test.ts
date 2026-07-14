import { describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../../audit/config/load.ts";
import { type AuditSuite, assembleRules } from "../../audit/rules/index.ts";
import { runAudit } from "../../audit/run.ts";
import { runBuildPlugin } from "../build.ts";
import { loadPlugins, normalizeExport } from "../load.ts";
import { resolvePluginTsPath } from "../paths.ts";

const CONSUMER = join(import.meta.dir, "../../audit/__tests__/fixtures/plugins/consumer");

describe("assembleRules", () => {
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

	it("build-plugin --check fails when stale", async () => {
		await runBuildPlugin({ root: CONSUMER });
		const ts = join(CONSUMER, ".skeleton/plugins/example/example.ts");
		const mjs = join(CONSUMER, ".skeleton/plugins/example/example.mjs");
		const old = new Date(Date.now() - 60_000);
		const newer = new Date();
		utimesSync(mjs, old, old);
		utimesSync(ts, newer, newer);
		await expect(runBuildPlugin({ root: CONSUMER, check: true })).rejects.toThrow(/stale/);
		await runBuildPlugin({ root: CONSUMER });
	});

	it("build-plugin --check fails when local .js→.ts dep is newer", async () => {
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
			const mjs = join(dir, ".skeleton/plugins/multi/entry.mjs");
			const util = join(dir, ".skeleton/plugins/multi/util.ts");
			const old = new Date(Date.now() - 60_000);
			const newer = new Date();
			utimesSync(mjs, old, old);
			utimesSync(util, newer, newer);
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
});
