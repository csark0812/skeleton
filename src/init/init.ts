import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { mergeHookConfigs, mergePackageJsonScripts, type MergeHookResult } from "./merge-hooks.ts";
import { resolveHookCommand } from "./resolve-hook-command.ts";

const TEMPLATES_DIR = join(dirname(fileURLToPath(import.meta.url)), "../../templates/skeleton-init");

export interface InitOptions {
	cwd?: string;
	forceHooks?: boolean;
	skills?: boolean;
	noSkills?: boolean;
	globalSkills?: boolean;
}

export interface InitResult {
	scaffold: "created" | "skipped";
	hooks: MergeHookResult[];
	scripts: "added" | "updated" | "skipped";
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
	if (!hasDep && !existsSync(join(dirname(fileURLToPath(import.meta.url)), "../../package.json"))) {
		console.error(
			"warning: @csark0812/skeleton not found in package.json — install with npm install -D @csark0812/skeleton",
		);
	}
}

export function runInit(options: InitOptions = {}): InitResult {
	const cwd = options.cwd ?? process.cwd();
	assertPackageResolvable(cwd);

	const scaffold = writeScaffold(cwd);
	const hookCommand = resolveHookCommand(cwd);
	const hooks = mergeHookConfigs({ cwd, hookCommand, forceHooks: options.forceHooks });
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

	if (options.skills && !options.noSkills) {
		console.log(
			"init: run manually — npx skills add csark0812/skeleton --skill skeleton -y",
		);
	}

	return { scaffold, hooks, scripts };
}
