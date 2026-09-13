import { afterEach, describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInit, skillsAddArgs } from "../../init/init.ts";
import { mergePackageJsonScripts } from "../../init/merge-scripts.ts";
import { parseInitArgs } from "../../init/parse-args.ts";

let tempDirs: string[] = [];

function makeRepo(extra: Record<string, unknown> = {}): string {
	const dir = mkdtempSync(join(tmpdir(), "skeleton-init-"));
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

describe("skeleton init helpers", () => {
	it("mergePackageJsonScripts is skipped without package.json", () => {
		const cwd = mkdtempSync(join(tmpdir(), "skeleton-init-nopkg-"));
		tempDirs.push(cwd);
		expect(mergePackageJsonScripts(cwd)).toBe("skipped");
	});

	it("parseInitArgs forwards unknown flags to skills", () => {
		expect(parseInitArgs(["--skills", "-g", "--all"])).toEqual({
			skills: true,
			noSkills: false,
			skillsFlags: ["-g", "--all"],
		});
	});

	it("rejects --force-hooks", () => {
		expect(() => parseInitArgs(["--force-hooks"])).toThrow(/--force-hooks was removed/);
	});
});

describe("skeleton init", () => {
	it("fresh init writes scaffold, scripts, and pre-commit", () => {
		const cwd = makeRepo();
		const result = runInit({ cwd });
		expect(result.scaffold).toBe("created");
		expect(existsSync(join(cwd, "skeleton.toml"))).toBe(true);
		expect(existsSync(join(cwd, ".skeleton/config.yaml"))).toBe(false);
		expect(existsSync(join(cwd, ".skeleton/registry.md"))).toBe(false);
		expect(existsSync(join(cwd, ".skeleton/customize"))).toBe(false);
		expect(existsSync(join(cwd, ".cursor/hooks.json"))).toBe(false);
		const pkg = JSON.parse(readFileSync(join(cwd, "package.json"), "utf8"));
		expect(pkg.scripts["validate:changed"]).toBe("skeleton validate changed");
		expect(existsSync(join(cwd, ".pre-commit-config.yaml"))).toBe(true);
		const hook = readFileSync(join(cwd, ".pre-commit-config.yaml"), "utf8");
		expect(hook).toContain("validate changed --staged");
		expect(hook).not.toContain("bun test");
		expect(readFileSync(join(cwd, "skeleton.toml"), "utf8")).toContain('mode = "hash"');
	});

	it("skips an existing skeleton pre-commit hook on re-init", () => {
		const cwd = makeRepo();
		runInit({ cwd });
		const result = runInit({ cwd });
		expect(result.precommit).toBe("skipped");
	});

	it("idempotent re-run skips unchanged scaffold", () => {
		const cwd = makeRepo();
		runInit({ cwd });
		const result = runInit({ cwd });
		expect(result.scaffold).toBe("skipped");
	});

	it("does not overwrite existing skeleton.toml on re-init", () => {
		const cwd = makeRepo();
		runInit({ cwd });
		const configPath = join(cwd, "skeleton.toml");
		writeFileSync(
			configPath,
			'daysUntilStale = 90\n\n[scan]\ninclude = ["custom"]\nexclude = []\n',
		);
		runInit({ cwd });
		expect(readFileSync(configPath, "utf8")).toContain("custom");
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
		expect(calls).toEqual([{ args: skillsAddArgs(), cwd }]);
	});

	it("installs the package skill for Cursor, Claude Code, and Codex by default", () => {
		expect(skillsAddArgs()).toEqual([
			"skills",
			"add",
			"csark0812/skeleton",
			"--skill",
			"skeleton",
			"-a",
			"cursor",
			"claude-code",
			"codex",
			"-y",
		]);
	});

	it("passes skills add flags through to npx", () => {
		const cwd = makeRepo();
		const calls: Array<{ args: string[]; cwd: string }> = [];
		runInit({
			cwd,
			skills: true,
			skillsFlags: ["-g", "-a", "codex", "--copy"],
			runSkillsCommand: (args, commandCwd) => {
				calls.push({ args, cwd: commandCwd });
				return 0;
			},
		});
		expect(calls).toEqual([
			{
				args: skillsAddArgs({
					skillsFlags: ["-g", "-a", "codex", "--copy"],
				}),
				cwd,
			},
		]);
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
