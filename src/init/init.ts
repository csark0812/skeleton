import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
	mergeHookConfigs,
	mergePackageJsonScripts,
	type MergeHookResult,
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
	scripts: "added" | "updated" | "skipped";
	skills: "installed" | "skipped";
}

function writeScaffold(cwd: string): "created" | "skipped" {
	const skeletonDir = join(cwd, ".skeleton");
	mkdirSync(skeletonDir, { recursive: true });

	let created = false;
	const configPath = join(skeletonDir, "config.yaml");
	if (!existsSync(configPath)) {
		copyFileSync(join(TEMPLATES_DIR, "config.yaml"), configPath);
		created = true;
	}

	const registryPath = join(skeletonDir, "registry.md");
	if (!existsSync(registryPath)) {
		copyFileSync(join(TEMPLATES_DIR, "registry.md"), registryPath);
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
		pkg.devDependencies?.["@csark0812/skeleton"] ||
		pkg.dependencies?.["@csark0812/skeleton"];
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

export function runInit(options: InitOptions = {}): InitResult {
	const cwd = options.cwd ?? process.cwd();
	assertPackageResolvable(cwd);

	const scaffold = writeScaffold(cwd);
	const hookCommand = resolveHookCommand(cwd);
	const hooks = mergeHookConfigs({
		cwd,
		hookCommand,
		forceHooks: options.forceHooks,
	});
	const scripts = mergePackageJsonScripts(cwd);

	for (const result of hooks) {
		if (result.action === "conflict") {
			console.error(
				`init: skipped ${result.platform} hook (user-edited) — re-run with --force-hooks to restore`,
			);
		} else if (result.action === "added") {
			console.log(`init: added ${result.platform} customize hook`);
		} else if (result.action === "updated") {
			console.log(`init: updated ${result.platform} customize hook`);
		}
	}

	if (scaffold === "created") {
		console.log("init: wrote .skeleton/config.yaml and registry.md");
	} else {
		console.log("init: .skeleton/ already present — skipped scaffold write");
	}

	if (scripts === "updated") {
		console.log("init: merged validate/audit scripts into package.json");
	}

	let skills: InitResult["skills"] = "skipped";
	if (options.skills && !options.noSkills) {
		const args = skillsAddArgs({ skillsFlags: options.skillsFlags });
		const run = options.runSkillsCommand ?? runSkillsAdd;
		const exitCode = run(args, cwd);
		if (exitCode !== 0) {
			throw new Error(`skills install failed: npx ${args.join(" ")}`);
		}
		skills = "installed";
		console.log("init: installed /skeleton skill");
	}

	return { scaffold, hooks, scripts, skills };
}
