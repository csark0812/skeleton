import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";
import {
	type MergeAction,
	type MergeHookResult,
	mergeHookConfigs,
	mergePackageJsonScripts,
} from "./merge-hooks.ts";
import { resolvePackageRoot, resolveTemplatesDir } from "./package-paths.ts";
import { resolveHookCommand } from "./resolve-hook-command.ts";
import { skillsAddArgs } from "./skills-args.ts";

const TEMPLATES_DIR = resolveTemplatesDir();

export interface InitOptions {
	cwd?: string;
	forceHooks?: boolean;
	skills?: boolean;
	noSkills?: boolean;
	skillsFlags?: string[];
	runSkillsCommand?: (args: string[], cwd: string) => number;
}

export interface InitResult {
	scaffold: "created" | "skipped";
	hooks: MergeHookResult[];
	scripts: MergeAction;
	skills: "installed" | "skipped";
}

function writeScaffold(cwd: string): "created" | "skipped" {
	const skeletonDir = join(cwd, ".skeleton");
	mkdirSync(skeletonDir, { recursive: true });

	let created = false;
	const tomlPath = join(cwd, "skeleton.toml");
	const legacyYaml = join(skeletonDir, "config.yaml");
	if (!(existsSync(tomlPath) || existsSync(legacyYaml))) {
		copyFileSync(join(TEMPLATES_DIR, "skeleton.toml"), tomlPath);
		created = true;
	}

	mkdirSync(join(skeletonDir, "customize"), { recursive: true });
	return created ? "created" : "skipped";
}

function assertPackageResolvable(cwd: string): void {
	const pkgPath = join(cwd, "package.json");
	if (!existsSync(pkgPath)) return;
	const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as {
		devDependencies?: Record<string, string>;
		dependencies?: Record<string, string>;
	};
	const hasDep =
		pkg.devDependencies?.["@csark0812/skeleton"] || pkg.dependencies?.["@csark0812/skeleton"];
	if (!hasDep) {
		try {
			resolvePackageRoot();
		} catch {
			console.error(
				"warning: @csark0812/skeleton not found in package.json — install with npm install -D @csark0812/skeleton",
			);
		}
	}
}

export { skillsAddArgs } from "./skills-args.ts";

function runSkillsAdd(args: string[], cwd: string): number {
	const result = spawnSync("npx", args, {
		cwd,
		stdio: "inherit",
		shell: false,
	});
	return result.status ?? 1;
}

function logHookMergeResult(result: MergeHookResult): void {
	if (result.action === "conflict") {
		console.error(
			`init: skipped ${result.platform} hook (user-edited) — re-run with --force-hooks to restore`,
		);
		return;
	}
	if (result.action === "added") console.log(`init: added ${result.platform} customize hook`);
	if (result.action === "updated") console.log(`init: updated ${result.platform} customize hook`);
}

function installSkillsIfRequested(options: InitOptions, cwd: string): InitResult["skills"] {
	if (!(options.skills && !options.noSkills)) return "skipped";
	const args = skillsAddArgs({ skillsFlags: options.skillsFlags });
	const run = options.runSkillsCommand ?? runSkillsAdd;
	const exitCode = run(args, cwd);
	if (exitCode !== 0) throw new Error(`skills install failed: npx ${args.join(" ")}`);
	console.log("init: installed /skeleton skill");
	return "installed";
}

export function runInit(options: InitOptions = {}): InitResult {
	const cwd = options.cwd ?? process.cwd();
	assertPackageResolvable(cwd);

	const scaffold = writeScaffold(cwd);
	const hookCommand = resolveHookCommand(cwd);
	const hooks = mergeHookConfigs({ cwd, hookCommand, forceHooks: options.forceHooks });
	const scripts = mergePackageJsonScripts(cwd);

	for (const result of hooks) logHookMergeResult(result);

	if (scaffold === "created") {
		console.log("init: wrote skeleton.toml (hooks optional — see docs)");
	} else {
		console.log("init: skeleton.toml or .skeleton/ already present — skipped scaffold write");
	}

	if (scripts === "updated") {
		console.log("init: merged validate/audit scripts into package.json");
	}

	const skills = installSkillsIfRequested(options, cwd);
	return { scaffold, hooks, scripts, skills };
}
