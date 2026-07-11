import { afterEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mergeHookConfigs, mergePackageJsonScripts } from "../../init/merge-hooks.ts";
import { runInit, skillsAddArgs } from "../../init/init.ts";
import { isSkeletonHookCommand, resolveHookCommand } from "../../init/resolve-hook-command.ts";

let tempDirs: string[] = [];
const TEMP_ROOT = join(import.meta.dir, "../../../.test-tmp");

function makeRepo(extra: Record<string, unknown> = {}): string {
	mkdirSync(TEMP_ROOT, { recursive: true });
	const dir = mkdtempSync(join(TEMP_ROOT, "skeleton-init-"));
	tempDirs.push(dir);
	writeFileSync(
		join(dir, "package.json"),
		JSON.stringify({ name: "fixture-repo", scripts: {}, ...extra }, null, 2),
	);
	return dir;
}

afterEach(() => {
	for (const dir of tempDirs) {
		rmSync(dir, { recursive: true, force: true });
	}
	tempDirs = [];
});

describe("skeleton init", () => {
	it("fresh init writes scaffold, hooks, and scripts", () => {
		const cwd = makeRepo();
		const result = runInit({ cwd });
		expect(result.scaffold).toBe("created");
		expect(existsSync(join(cwd, ".skeleton/config.yaml"))).toBe(true);
		expect(existsSync(join(cwd, ".skeleton/registry.md"))).toBe(true);
		expect(existsSync(join(cwd, ".cursor/hooks.json"))).toBe(true);
		expect(existsSync(join(cwd, ".claude/settings.json"))).toBe(true);
		const pkg = JSON.parse(readFileSync(join(cwd, "package.json"), "utf8"));
		expect(pkg.scripts["validate:changed"]).toBe("skeleton validate changed");
	});

	it("idempotent re-run skips unchanged hooks and scaffold", () => {
		const cwd = makeRepo();
		runInit({ cwd });
		const result = runInit({ cwd });
		expect(result.scaffold).toBe("skipped");
		expect(result.hooks.every((h) => h.action === "skipped")).toBe(true);
	});

	it("preserves unrelated cursor hooks", () => {
		const cwd = makeRepo();
		mkdirSync(join(cwd, ".cursor"), { recursive: true });
		writeFileSync(
			join(cwd, ".cursor/hooks.json"),
			JSON.stringify({
				version: 1,
				hooks: {
					postToolUse: [{ command: "echo user-hook", matcher: "Write" }],
				},
			}),
		);
		runInit({ cwd });
		const hooks = JSON.parse(readFileSync(join(cwd, ".cursor/hooks.json"), "utf8"));
		expect(hooks.hooks.postToolUse).toHaveLength(2);
		expect(hooks.hooks.postToolUse.some((h: { command: string }) => h.command === "echo user-hook")).toBe(
			true,
		);
	});

	it("preserves Claude permissions sibling keys", () => {
		const cwd = makeRepo();
		mkdirSync(join(cwd, ".claude"), { recursive: true });
		writeFileSync(
			join(cwd, ".claude/settings.json"),
			JSON.stringify({ permissions: { allow: ["Read"] }, hooks: {} }),
		);
		runInit({ cwd });
		const settings = JSON.parse(readFileSync(join(cwd, ".claude/settings.json"), "utf8"));
		expect(settings.permissions).toEqual({ allow: ["Read"] });
	});

	it("skips user-edited skeleton hook unless --force-hooks", () => {
		const cwd = makeRepo();
		mkdirSync(join(cwd, ".cursor"), { recursive: true });
		writeFileSync(
			join(cwd, ".cursor/hooks.json"),
			JSON.stringify({
				version: 1,
				hooks: {
					postToolUse: [{ command: "node customize-on-skill-read.js", matcher: "Write" }],
				},
			}),
		);
		const conflict = mergeHookConfigs({
			cwd,
			hookCommand: resolveHookCommand(cwd),
		});
		expect(conflict[0]?.action).toBe("conflict");
		const forced = mergeHookConfigs({
			cwd,
			hookCommand: resolveHookCommand(cwd),
			forceHooks: true,
		});
		expect(forced[0]?.action).toBe("updated");
		const hooks = JSON.parse(readFileSync(join(cwd, ".cursor/hooks.json"), "utf8"));
		expect(hooks.hooks.postToolUse[0].matcher).toBe("Read");
	});

	it("hard-fails on invalid hook JSON", () => {
		const cwd = makeRepo();
		mkdirSync(join(cwd, ".cursor"), { recursive: true });
		writeFileSync(join(cwd, ".cursor/hooks.json"), "{not json");
		expect(() =>
			mergeHookConfigs({ cwd, hookCommand: resolveHookCommand(cwd) }),
		).toThrow(/Invalid JSON/);
	});

	it("resolves hoisted package hook from node_modules", () => {
		const cwd = makeRepo();
		const hookDir = join(cwd, "node_modules", "@csark0812", "skeleton", "dist", "hooks");
		mkdirSync(hookDir, { recursive: true });
		writeFileSync(join(hookDir, "customize-on-skill-read.js"), "// stub\n");
		const command = resolveHookCommand(cwd);
		expect(command).toContain("node_modules/@csark0812/skeleton/dist/hooks/customize-on-skill-read.js");
	});

	it("skips codex hooks when .codex directory is missing", () => {
		const cwd = makeRepo();
		const results = mergeHookConfigs({ cwd, hookCommand: resolveHookCommand(cwd) });
		const codex = results.find((r) => r.platform === "codex");
		expect(codex?.action).toBe("skipped");
		expect(existsSync(join(cwd, ".codex/hooks.json"))).toBe(false);
	});

	it("falls back to node_modules relative command when package missing", () => {
		const cwd = mkdtempSync(join(tmpdir(), "skeleton-init-fallback-"));
		tempDirs.push(cwd);
		const command = resolveHookCommand(cwd);
		expect(command).toBe(
			"node node_modules/@csark0812/skeleton/dist/hooks/customize-on-skill-read.js",
		);
	});

	it("resolveHookCommand returns a skeleton customize hook path", () => {
		const cwd = makeRepo();
		const command = resolveHookCommand(cwd);
		expect(isSkeletonHookCommand(command)).toBe(true);
		expect(command.includes("customize-on-skill-read")).toBe(true);
	});

	it("re-init upgrades hook command in place without duplicating entries", () => {
		const cwd = makeRepo();
		const tsCommand = "bun src/hooks/customize-on-skill-read.ts";
		mergeHookConfigs({ cwd, hookCommand: tsCommand, forceHooks: true });
		const jsCommand = "node dist/hooks/customize-on-skill-read.js";
		mergeHookConfigs({ cwd, hookCommand: jsCommand, forceHooks: true });
		const hooks = JSON.parse(readFileSync(join(cwd, ".cursor/hooks.json"), "utf8"));
		const skeletonHooks = hooks.hooks.postToolUse.filter((h: { command: string }) =>
			isSkeletonHookCommand(h.command),
		);
		expect(skeletonHooks).toHaveLength(1);
	});

	it("does not overwrite existing .skeleton config on re-init", () => {
		const cwd = makeRepo();
		runInit({ cwd });
		const configPath = join(cwd, ".skeleton/config.yaml");
		writeFileSync(configPath, "scan:\n  include: [custom]\n  exclude: []\n  banned: []\ndaysUntilStale: 90\n");
		runInit({ cwd });
		expect(readFileSync(configPath, "utf8")).toContain("custom");
	});

	it("mergePackageJsonScripts is skipped without package.json", () => {
		mkdirSync(TEMP_ROOT, { recursive: true });
		const cwd = mkdtempSync(join(TEMP_ROOT, "skeleton-init-nopkg-"));
		tempDirs.push(cwd);
		expect(mergePackageJsonScripts(cwd)).toBe("skipped");
	});

	it("writes .skeleton/customize directory", () => {
		const cwd = makeRepo();
		runInit({ cwd });
		expect(existsSync(join(cwd, ".skeleton/customize"))).toBe(true);
	});

	it("runs skills add when --skills is requested", () => {
		const cwd = makeRepo();
		const calls: Array<{ args: string[]; cwd: string }> = [];
		const result = runInit({
			cwd,
			skills: true,
			runSkillsCommand: (args, commandCwd) => {
				calls.push({ args, cwd: commandCwd });
				return 0;
			},
		});
		expect(result.skills).toBe("installed");
		expect(calls).toEqual([{ args: skillsAddArgs(false), cwd }]);
	});

	it("adds -g for global skill installs", () => {
		const args = skillsAddArgs(true);
		expect(args).toContain("-g");
	});

	it("fails init when skills add fails", () => {
		const cwd = makeRepo();
		expect(() =>
			runInit({
				cwd,
				skills: true,
				runSkillsCommand: () => 1,
			}),
		).toThrow(/skills install failed/);
	});
});
