import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { basename, extname, join } from "node:path";
import { findRepoRoot, loadConfig } from "../audit/config/load.ts";
import { collectScanFiles, relPath as relPathFromAbs } from "../audit/core/collect.ts";
import { matchesGlobScope, normalizeRelPath } from "../audit/core/shared.ts";
import {
	buildSkillIndex,
	isForeignSkillPath,
	isSkillPath,
	listSkillMarkdownPaths,
	type SkillIndex,
} from "../audit/core/skill-roots.ts";
import { loadPolicyFile } from "../audit/policies/load.ts";
import { runAudit } from "../audit/run.ts";
import { collectWiredPolicyRelPaths } from "../plugins/load.ts";
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

type Bucket = "docs" | "skills" | "shell" | "json" | "policy" | "skip" | "foreign-skill";

type BucketKey = Exclude<Bucket, "skip" | "foreign-skill">;

interface BucketContext {
	root: string;
	wiredPolicies: Set<string>;
	skillIndex: SkillIndex;
}

interface ScanPerimeterContext {
	config: ReturnType<typeof loadConfig>;
	root: string;
	skillIndex: SkillIndex;
}

interface PathClassification {
	buckets: Record<BucketKey, string[]>;
	missing: number;
	skipped: number;
	foreignSkipped: number;
	orphans: string[];
}

/**
 * Candidate policy YAML under `.skeleton/` (not config.yaml).
 * Wired vs orphan is decided against plugin `policies` globs.
 */
function isSkeletonYamlCandidate(normalized: string, ext: string): boolean {
	if (!POLICY_EXTENSIONS.has(ext)) return false;
	if (!(normalized.startsWith(".skeleton/") || normalized.startsWith(".skeleton\\"))) {
		return false;
	}
	const name = basename(normalized).toLowerCase();
	if (name === "config.yaml" || name === "config.yml") return false;
	return true;
}

function bucketForSkillPath(normalized: string, skillIndex: SkillIndex): Bucket {
	if (!isSkillPath(normalized, skillIndex)) return "skip";
	if (isForeignSkillPath(normalized, skillIndex)) return "foreign-skill";
	return "skills";
}

function bucketForDocPath(normalized: string, ctx: BucketContext): Bucket {
	const ext = extname(normalized).toLowerCase();
	if (!DOC_EXTENSIONS.has(ext)) return "skip";
	const config = loadConfig(ctx.root);
	if (isInScanPerimeter(normalized, { config, root: ctx.root, skillIndex: ctx.skillIndex })) {
		return "docs";
	}
	return "skip";
}

function bucketFor(relPath: string, ctx: BucketContext): Bucket {
	const normalized = normalizeRelPath(relPath);
	const ext = extname(normalized).toLowerCase();
	const name = basename(normalized);

	if (SKIP_EXTENSIONS.has(ext) || COMMAND_CONFIG_NAMES.has(name)) return "skip";

	if (isSkeletonYamlCandidate(normalized, ext)) {
		return ctx.wiredPolicies.has(normalized) ? "policy" : "skip";
	}

	const skillBucket = bucketForSkillPath(normalized, ctx.skillIndex);
	if (skillBucket !== "skip") return skillBucket;

	const docBucket = bucketForDocPath(normalized, ctx);
	if (docBucket !== "skip") return docBucket;

	if (SHELL_EXTENSIONS.has(ext)) return "shell";
	if (ext === ".json") return "json";
	return "skip";
}

function isInScanPerimeter(relPath: string, ctx: ScanPerimeterContext): boolean {
	const scanned = new Set(
		collectScanFiles(ctx.config, ctx.root, ctx.skillIndex).map((abs) =>
			relPathFromAbs(abs, ctx.root),
		),
	);
	if (scanned.has(relPath)) return true;
	return ctx.config.scan.include.some((pattern) => matchesGlobScope(relPath, pattern));
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

type PackageManager = "bun" | "npm" | "pnpm" | "yarn";

function packageManagerFromPackageJson(root: string): PackageManager | null {
	const pkgPath = join(root, "package.json");
	if (!existsSync(pkgPath)) return null;
	try {
		const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { packageManager?: string };
		const raw = pkg.packageManager?.split("@")[0];
		if (raw === "bun" || raw === "npm" || raw === "pnpm" || raw === "yarn") return raw;
	} catch {
		// ignore malformed package.json
	}
	return null;
}

function packageManagerFromLockfiles(root: string): PackageManager | null {
	if (existsSync(join(root, "bun.lock")) || existsSync(join(root, "bun.lockb"))) return "bun";
	if (existsSync(join(root, "pnpm-lock.yaml"))) return "pnpm";
	if (existsSync(join(root, "yarn.lock"))) return "yarn";
	if (existsSync(join(root, "package-lock.json"))) return "npm";
	return null;
}

function hintForPackageManager(pm: PackageManager): string {
	switch (pm) {
		case "bun":
			return "  Run: bun test && bun run typecheck && bun run build";
		case "npm":
			return "  Run: npm test && npm run typecheck";
		case "pnpm":
			return "  Run: pnpm test && pnpm run typecheck";
		case "yarn":
			return "  Run: yarn test && yarn typecheck";
	}
}

/** Prefer the repo's package manager so skip tips don't send npm consumers to bun. */
export function codeValidationHint(root: string): string {
	const pm = packageManagerFromPackageJson(root) ?? packageManagerFromLockfiles(root);
	return pm
		? hintForPackageManager(pm)
		: "  Run your local code validation gates (test + typecheck + build).";
}

function emptyBuckets(): Record<BucketKey, string[]> {
	return { docs: [], skills: [], shell: [], json: [], policy: [] };
}

interface ClassifyContext {
	relPaths: string[];
	root: string;
	wiredPolicies: Set<string>;
	skillIndex: SkillIndex;
}

interface ClassifySingleContext {
	relPath: string;
	ctx: ClassifyContext;
	state: PathClassification;
	bucketCtx: BucketContext;
}

function classifySinglePath(input: ClassifySingleContext): void {
	const { relPath, ctx, state, bucketCtx } = input;
	const normalized = normalizeRelPath(relPath);
	const abs = join(ctx.root, normalized);
	if (!existsSync(abs)) {
		state.missing++;
		console.error(`validate changed: path not found: ${relPath}`);
		return;
	}
	const ext = extname(normalized).toLowerCase();
	if (isSkeletonYamlCandidate(normalized, ext) && !ctx.wiredPolicies.has(normalized)) {
		state.orphans.push(normalized);
		return;
	}
	const bucket = bucketFor(normalized, bucketCtx);
	if (bucket === "skip") {
		state.skipped++;
		return;
	}
	if (bucket === "foreign-skill") {
		state.foreignSkipped++;
		console.log(
			`validate changed: skipping foreign skill ${normalized} (owned upstream; see skills-lock.json / skillOwnership)`,
		);
		return;
	}
	state.buckets[bucket].push(normalized);
}

function classifyPaths(ctx: ClassifyContext): PathClassification {
	const state: PathClassification = {
		buckets: emptyBuckets(),
		missing: 0,
		skipped: 0,
		foreignSkipped: 0,
		orphans: [],
	};
	const bucketCtx: BucketContext = {
		root: ctx.root,
		wiredPolicies: ctx.wiredPolicies,
		skillIndex: ctx.skillIndex,
	};

	for (const relPath of ctx.relPaths) {
		classifySinglePath({ relPath, ctx, state, bucketCtx });
	}

	return state;
}

function reportOrphans(orphans: string[]): number {
	for (const orphan of orphans) {
		console.error(
			`validate changed: ${orphan} is under .skeleton/ but not referenced by any plugin policies glob.\n` +
				"  Export it from a plugin `policies` array (see docs/developer/plugins.md), or remove the file.",
		);
	}
	return 1;
}

async function runGlobalAuditIfBase(base: string | undefined, root: string): Promise<number> {
	if (!base) return 0;
	return runAudit({
		suite: "self",
		strict: false,
		json: false,
		paths: [],
		only: null,
		root,
		globalOnly: true,
	});
}

async function auditDocsBucket(paths: string[], root: string): Promise<number> {
	if (paths.length === 0) return 0;
	return runAudit({
		suite: "docs",
		strict: false,
		json: false,
		paths,
		only: null,
		root,
		pathScopedOnly: true,
	});
}

async function auditSkillsBucket(
	paths: string[],
	root: string,
	base: string | undefined,
): Promise<number> {
	if (paths.length === 0) return 0;
	if (!base) {
		console.error(
			"validate changed: skill paths need the full skills suite (path-scoped skill rules are empty).\n" +
				"  Run: skeleton audit skills\n" +
				"  (audit self covers docs + .skeleton; excluded skill trees still need audit skills)",
		);
		return 1;
	}
	return runAudit({
		suite: "skills",
		strict: false,
		json: false,
		paths,
		only: null,
		root,
		pathScopedOnly: true,
	});
}

function validateLocalBuckets(buckets: Record<BucketKey, string[]>, root: string): number {
	let exitCode = 0;
	for (const relPath of buckets.shell) {
		if (validateShell(relPath, root) !== 0) exitCode = 1;
	}
	for (const relPath of buckets.json) {
		if (validateJson(relPath, root) !== 0) exitCode = 1;
	}
	for (const relPath of buckets.policy) {
		if (validatePolicy(relPath, root) !== 0) exitCode = 1;
	}
	return exitCode;
}

async function provePolicyProse(root: string, skillIndex: SkillIndex): Promise<number> {
	const proseExit = await runAudit({
		suite: "docs",
		strict: false,
		json: false,
		paths: [],
		only: null,
		root,
	});
	if (proseExit !== 0) return 1;

	const skillPaths = listSkillMarkdownPaths(root, skillIndex);
	if (skillPaths.length === 0) return 0;

	const skillProseExit = await runAudit({
		suite: "skills",
		strict: false,
		json: false,
		paths: skillPaths,
		only: null,
		root,
		pathScopedOnly: true,
	});
	return skillProseExit !== 0 ? 1 : 0;
}

interface PolicyBucketContext {
	policyPaths: string[];
	root: string;
	skillIndex: SkillIndex;
	base: string | undefined;
}

async function auditPolicyBucket(ctx: PolicyBucketContext): Promise<number> {
	if (ctx.policyPaths.length === 0) return 0;
	if (!ctx.base) {
		console.error(
			"validate changed: policy YAML changes need a full prose-policy pass (path-scoped docs are not enough).\n" +
				"  Run: skeleton audit docs\n" +
				"  And: skeleton audit skills\n" +
				"  (audit self covers docs + .skeleton; excluded skill trees still need audit skills)",
		);
		return 1;
	}
	return provePolicyProse(ctx.root, ctx.skillIndex);
}

function printSuccess(skipped: number, foreignSkipped: number): void {
	const parts: string[] = [];
	if (skipped > 0) parts.push(`${skipped} path(s) skipped`);
	if (foreignSkipped > 0) parts.push(`${foreignSkipped} foreign skill(s) ignored`);
	const note = parts.length > 0 ? ` (${parts.join(", ")})` : "";
	console.log(`validate changed passed${note}.`);
}

function auditedPathCount(buckets: Record<BucketKey, string[]>): number {
	return (
		buckets.docs.length +
		buckets.skills.length +
		buckets.shell.length +
		buckets.json.length +
		buckets.policy.length
	);
}

function earlyExitForClassification(
	classification: PathClassification,
	root: string,
	base?: string,
): number | null {
	const { buckets, missing, skipped, orphans } = classification;
	if (orphans.length > 0) return reportOrphans(orphans);

	const audited = auditedPathCount(buckets);
	if (missing > 0 && audited === 0 && skipped === 0) {
		console.error(
			"validate changed: no paths existed on disk. Pass real paths or use --staged / --base.",
		);
		return 1;
	}
	// Local/pre-commit: fail closed so callers do not assume TS was validated.
	// CI `--base`: continue so global rules still run (code gates stay outside this router).
	if (skipped > 0 && audited === 0 && !base) {
		console.error(
			"validate changed: all paths were skipped (code/config). This does not verify TypeScript or app code.\n" +
				codeValidationHint(root),
		);
		return 1;
	}
	return null;
}

interface BucketAuditContext {
	buckets: Record<BucketKey, string[]>;
	root: string;
	skillIndex: SkillIndex;
	base: string | undefined;
}

async function runBucketAudits(ctx: BucketAuditContext): Promise<number> {
	let exitCode = 0;
	const mergeExit = (code: number) => {
		if (code !== 0) exitCode = 1;
	};

	mergeExit(await runGlobalAuditIfBase(ctx.base, ctx.root));
	mergeExit(await auditDocsBucket(ctx.buckets.docs, ctx.root));
	mergeExit(await auditSkillsBucket(ctx.buckets.skills, ctx.root, ctx.base));
	mergeExit(validateLocalBuckets(ctx.buckets, ctx.root));
	mergeExit(
		await auditPolicyBucket({
			policyPaths: ctx.buckets.policy,
			root: ctx.root,
			skillIndex: ctx.skillIndex,
			base: ctx.base,
		}),
	);

	return exitCode;
}

export async function runValidateChanged(options: ValidateChangedOptions = {}): Promise<number> {
	const root = options.root ?? findRepoRoot();
	const relPaths = resolvePaths(options);

	if (relPaths.length === 0) {
		console.log("validate changed: no changed files.");
		return 0;
	}

	const config = loadConfig(root);
	const skillIndex = buildSkillIndex(root, config.skillOwnership);
	let wiredPolicies: Set<string>;
	try {
		wiredPolicies = await collectWiredPolicyRelPaths(root, config);
	} catch (error) {
		console.error(`validate changed: ${error instanceof Error ? error.message : error}`);
		return 1;
	}

	const classification = classifyPaths({
		relPaths,
		root,
		wiredPolicies,
		skillIndex,
	});

	const earlyExit = earlyExitForClassification(classification, root, options.base);
	if (earlyExit !== null) return earlyExit;

	const exitCode = await runBucketAudits({
		buckets: classification.buckets,
		root,
		skillIndex,
		base: options.base,
	});

	if (exitCode === 0) printSuccess(classification.skipped, classification.foreignSkipped);
	return exitCode;
}
