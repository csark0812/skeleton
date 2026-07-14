import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { basename, extname, join } from "node:path";
import { findRepoRoot, loadConfig } from "../audit/config/load.ts";
import { collectScanFiles, relPath as relPathFromAbs } from "../audit/core/collect.ts";
import { matchesGlobScope, normalizeRelPath } from "../audit/core/shared.ts";
import { buildSkillIndex, isSkillPath } from "../audit/core/skill-roots.ts";
import { loadPolicyFile } from "../audit/policies/load.ts";
import { runAudit } from "../audit/run.ts";
import { gitDiffChangedFiles } from "./git-diff.ts";

const DOC_EXTENSIONS = new Set([".md", ".mdc", ".yaml", ".yml"]);
const POLICY_EXTENSIONS = new Set([".yaml", ".yml"]);
const SHELL_EXTENSIONS = new Set([".sh", ".bash", ".zsh"]);
const SKIP_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".py"]);
const COMMAND_CONFIG_NAMES = new Set(["package.json", "project.json"]);

export interface ValidateChangedOptions {
	paths?: string[];
	staged?: boolean;
	base?: string;
	root?: string;
}

type Bucket = "docs" | "skills" | "shell" | "json" | "policy" | "skip";

function isPluginPolicyPath(normalized: string, ext: string): boolean {
	return (
		POLICY_EXTENSIONS.has(ext) &&
		(normalized.startsWith(".skeleton/plugins/") || normalized.startsWith(".skeleton/plugins\\"))
	);
}

function bucketFor(relPath: string, root: string): Bucket {
	const normalized = normalizeRelPath(relPath);
	const ext = extname(normalized).toLowerCase();
	const name = basename(normalized);

	if (SKIP_EXTENSIONS.has(ext)) return "skip";
	if (COMMAND_CONFIG_NAMES.has(name)) return "skip";

	if (isPluginPolicyPath(normalized, ext)) return "policy";

	const skillIndex = buildSkillIndex(root);
	if (isSkillPath(normalized, skillIndex)) return "skills";

	if (DOC_EXTENSIONS.has(ext)) {
		const config = loadConfig(root);
		if (isInScanPerimeter(normalized, config, root, skillIndex)) return "docs";
		return "skip";
	}

	if (SHELL_EXTENSIONS.has(ext)) return "shell";
	if (ext === ".json") return "json";
	return "skip";
}

function isInScanPerimeter(
	relPath: string,
	config: ReturnType<typeof loadConfig>,
	root: string,
	skillIndex: ReturnType<typeof buildSkillIndex>,
): boolean {
	const scanned = new Set(
		collectScanFiles(config, root, skillIndex).map((abs) => relPathFromAbs(abs, root)),
	);
	if (scanned.has(relPath)) return true;
	return config.scan.include.some((pattern) => matchesGlobScope(relPath, pattern));
}

function parseJsonContent(content: string): unknown {
	try {
		return JSON.parse(content);
	} catch {
		const withoutComments = content.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
		const withoutTrailingCommas = withoutComments.replace(/,\s*([}\]])/g, "$1");
		return JSON.parse(withoutTrailingCommas);
	}
}

function validateJson(relPath: string, root: string): number {
	const abs = join(root, relPath);
	try {
		parseJsonContent(readFileSync(abs, "utf8"));
		return 0;
	} catch (error) {
		console.error(`validate changed: invalid JSON in ${relPath}: ${error}`);
		return 1;
	}
}

function validatePolicy(relPath: string, root: string): number {
	const abs = join(root, relPath);
	try {
		loadPolicyFile(abs, readFileSync(abs, "utf8"));
		return 0;
	} catch (error) {
		console.error(`validate changed: invalid policy ${relPath}: ${error}`);
		return 1;
	}
}

function validateShell(relPath: string, root: string): number {
	const abs = join(root, relPath);
	const shellcheck = spawnSync("shellcheck", [abs], { encoding: "utf8" });
	if (shellcheck.status === 0) return 0;

	const bash = spawnSync("bash", ["-n", abs], { encoding: "utf8" });
	if (bash.status === 0) return 0;

	console.error(
		`validate changed: shell syntax check failed for ${relPath}: ${bash.stderr || shellcheck.stderr}`,
	);
	return 1;
}

function resolvePaths(options: ValidateChangedOptions): string[] {
	if (options.paths && options.paths.length > 0) {
		return options.paths.map((p) => normalizeRelPath(p));
	}
	return gitDiffChangedFiles({
		staged: options.staged,
		base: options.base,
		root: options.root,
	});
}

/** Prefer the repo's package manager so skip tips don't send npm consumers to bun. */
export function codeValidationHint(root: string): string {
	let pm: "bun" | "npm" | "pnpm" | "yarn" | null = null;
	const pkgPath = join(root, "package.json");
	if (existsSync(pkgPath)) {
		try {
			const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { packageManager?: string };
			const raw = pkg.packageManager?.split("@")[0];
			if (raw === "bun" || raw === "npm" || raw === "pnpm" || raw === "yarn") pm = raw;
		} catch {
			// ignore malformed package.json
		}
	}
	if (!pm) {
		if (existsSync(join(root, "bun.lock")) || existsSync(join(root, "bun.lockb"))) pm = "bun";
		else if (existsSync(join(root, "pnpm-lock.yaml"))) pm = "pnpm";
		else if (existsSync(join(root, "yarn.lock"))) pm = "yarn";
		else if (existsSync(join(root, "package-lock.json"))) pm = "npm";
	}
	switch (pm) {
		case "bun":
			return "  Run: bun test && bun run typecheck && bun run build";
		case "npm":
			return "  Run: npm test && npm run typecheck";
		case "pnpm":
			return "  Run: pnpm test && pnpm run typecheck";
		case "yarn":
			return "  Run: yarn test && yarn typecheck";
		default:
			return "  Run your local code validation gates (test + typecheck + build).";
	}
}

export async function runValidateChanged(options: ValidateChangedOptions = {}): Promise<number> {
	const root = options.root ?? findRepoRoot();
	const relPaths = resolvePaths(options);

	if (relPaths.length === 0) {
		console.log("validate changed: no changed files.");
		return 0;
	}

	const buckets: Record<Exclude<Bucket, "skip">, string[]> = {
		docs: [],
		skills: [],
		shell: [],
		json: [],
		policy: [],
	};
	let missing = 0;
	let skipped = 0;

	for (const relPath of relPaths) {
		const abs = join(root, relPath);
		if (!existsSync(abs)) {
			missing++;
			console.error(`validate changed: path not found: ${relPath}`);
			continue;
		}
		const bucket = bucketFor(relPath, root);
		if (bucket === "skip") {
			skipped++;
			continue;
		}
		buckets[bucket].push(relPath);
	}

	const audited =
		buckets.docs.length +
		buckets.skills.length +
		buckets.shell.length +
		buckets.json.length +
		buckets.policy.length;

	let exitCode = 0;

	if (missing > 0 && audited === 0 && skipped === 0) {
		console.error(
			"validate changed: no paths existed on disk. Pass real paths or use --staged / --base.",
		);
		return 1;
	}

	if (options.base) {
		const globalExit = await runAudit({
			suite: "self",
			strict: false,
			json: false,
			paths: [],
			only: null,
			root,
			globalOnly: true,
		});
		if (globalExit !== 0) exitCode = 1;
	}

	if (skipped > 0 && audited === 0) {
		console.error(
			"validate changed: all paths were skipped (code/config). This does not verify TypeScript or app code.\n" +
				codeValidationHint(root),
		);
		return 1;
	}

	if (buckets.docs.length > 0) {
		const docExit = await runAudit({
			suite: "docs",
			strict: false,
			json: false,
			paths: buckets.docs,
			only: null,
			root,
			pathScopedOnly: true,
		});
		if (docExit !== 0) exitCode = 1;
	}

	if (buckets.skills.length > 0) {
		const skillsOnly =
			buckets.docs.length === 0 && buckets.shell.length === 0 && buckets.json.length === 0;
		// Skill-body rules are global; path-scoped skill audit does not cover them.
		// Without --base (CI globals), fail and redirect so green is not mistaken for coverage.
		if (skillsOnly && !options.base) {
			console.error(
				"validate changed: skill paths need the full skills suite (path-scoped skill rules are empty).\n" +
					"  Run: skeleton audit skills\n" +
					"  Or:  skeleton audit self",
			);
			return 1;
		}
		const skillExit = await runAudit({
			suite: "skills",
			strict: false,
			json: false,
			paths: buckets.skills,
			only: null,
			root,
			pathScopedOnly: true,
		});
		if (skillExit !== 0) exitCode = 1;
	}

	for (const relPath of buckets.shell) {
		if (validateShell(relPath, root) !== 0) exitCode = 1;
	}

	for (const relPath of buckets.json) {
		if (validateJson(relPath, root) !== 0) exitCode = 1;
	}

	for (const relPath of buckets.policy) {
		if (validatePolicy(relPath, root) !== 0) exitCode = 1;
	}

	if (exitCode === 0) {
		const note = skipped > 0 ? ` (${skipped} path(s) skipped)` : "";
		console.log(`validate changed passed${note}.`);
	}

	return exitCode;
}
