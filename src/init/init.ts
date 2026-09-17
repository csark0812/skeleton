import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";
import { mergePrecommitConfig } from "./merge-precommit.ts";
import { type MergeAction, mergePackageJsonScripts } from "./merge-scripts.ts";
import { resolvePackageRoot, resolveTemplatesDir } from "./package-paths.ts";
import { skillsAddArgs } from "./skills-args.ts";

const TEMPLATES_DIR = resolveTemplatesDir();
export const SKELETON_AGENT_GUIDE = `\n<!-- skeleton: context-guide -->\n## Skeleton context\n\nMake \`npx --no-install skeleton context "<topic>"\` the first repository command. Use \`--path\` only for a known implementation path and \`--staged\` for staged-code questions. Returned document, source, and test excerpts are already read; do not read those files again. Complete every \`action\` line and verify it against the final files. Preserve existing work. If a test is returned, edit and run only that test. Otherwise use one combined command to find and read the focused test. Stop when it passes. Do not run Skeleton audits, validation, or review-proof commands unless the user requested them or the focused test fails. Broader discovery or another context command is reserved for \`no-context\`, omitted evidence, or a failing focused test.\n`;

export function withSkeletonAgentGuide(contents: string): string {
	if (contents.includes("<!-- skeleton: context-guide -->")) return contents;
	return `${contents.trimEnd()}\n${SKELETON_AGENT_GUIDE}`;
}

export interface InitOptions {
	cwd?: string;
	skills?: boolean;
	noSkills?: boolean;
	skillsFlags?: string[];
	runSkillsCommand?: (args: string[], cwd: string) => number;
}

export interface InitResult {
	scaffold: "created" | "skipped";
	scripts: MergeAction;
	skills: "installed" | "skipped";
	precommit: MergeAction;
	agentGuide: "added" | "skipped";
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

function mergeAgentGuide(cwd: string): InitResult["agentGuide"] {
	const path = join(cwd, "AGENTS.md");
	const existing = existsSync(path) ? readFileSync(path, "utf8") : "# Agent entry\n";
	if (existing.includes("<!-- skeleton: context-guide -->")) return "skipped";
	writeFileSync(path, withSkeletonAgentGuide(existing), "utf8");
	return "added";
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

function installSkillsIfRequested(options: InitOptions, cwd: string): InitResult["skills"] {
	if (!(options.skills && !options.noSkills)) return "skipped";
	const args = skillsAddArgs({
		skillsFlags: options.skillsFlags,
		source: resolvePackageRoot(),
	});
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
	const scripts = mergePackageJsonScripts(cwd);
	const precommit = mergePrecommitConfig(cwd);
	const agentGuide = mergeAgentGuide(cwd);

	if (scaffold === "created") {
		console.log("init: wrote skeleton.toml");
	} else {
		console.log("init: skeleton.toml or .skeleton/ already present — skipped scaffold write");
	}

	if (scripts === "updated") {
		console.log("init: merged validate/audit scripts into package.json");
	}

	if (precommit === "added") {
		console.log("init: wrote .pre-commit-config.yaml (run pre-commit install once per machine)");
	} else if (precommit === "updated") {
		console.log("init: added skeleton validate hook to .pre-commit-config.yaml");
	}
	if (agentGuide === "added") console.log("init: added Skeleton context guidance to AGENTS.md");

	const skills = installSkillsIfRequested(options, cwd);
	return { scaffold, scripts, skills, precommit, agentGuide };
}
