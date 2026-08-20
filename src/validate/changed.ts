import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { basename, extname, join } from "node:path";
import { findRepoRoot, loadConfig } from "../audit/config/load.ts";
import { parseCodeFitMarkers } from "../audit/core/code-fit.ts";
import { collectScanFiles, relPath as relPathFromAbs } from "../audit/core/collect.ts";
import { type Issue, issue } from "../audit/core/report.ts";
import { formatLocalReviewDate } from "../audit/core/review-proof.ts";
import { docMetaLastReviewed, matchesGlobScope, normalizeRelPath } from "../audit/core/shared.ts";
import {
	buildSkillIndex,
	isForeignSkillPath,
	isSkillPath,
	listSkillMarkdownPaths,
	type SkillIndex,
} from "../audit/core/skill-roots.ts";
import { loadPolicyFile } from "../audit/policies/load.ts";
import { evaluateAudit, printAuditResult } from "../audit/run.ts";
import { collectWiredPolicyRelPaths } from "../plugins/load.ts";
import type {
	AuditResult,
	ImpactedDocument,
	ValidateChangedResult,
	ValidateClassificationResult,
} from "../result-types.ts";
import { gitDiffChangedFiles } from "./git-diff.ts";

const DOC_EXTENSIONS = new Set([".md", ".mdc", ".yaml", ".yml"]);
const POLICY_EXTENSIONS = new Set([".yaml", ".yml"]);
const SHELL_EXTENSIONS = new Set([".sh", ".bash", ".zsh"]);
const CODE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".py"]);
const COMMAND_CONFIG_NAMES = new Set(["package.json", "project.json"]);

export interface ValidateChangedOptions {
	paths?: string[];
	staged?: boolean;
	base?: string;
	root?: string;
	json?: boolean;
}

type Bucket = "docs" | "code" | "skills" | "shell" | "json" | "policy" | "skip" | "foreign-skill";

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
	missing: string[];
	skipped: string[];
	foreignSkipped: string[];
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

	if (CODE_EXTENSIONS.has(ext)) return "code";
	if (COMMAND_CONFIG_NAMES.has(name)) return "skip";

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

function validationIssue(code: string, file: string, message: string): Issue {
	return issue("validate-changed", file, { code, message, severity: "error" });
}

function validateJson(relPath: string, root: string): Issue | null {
	const abs = join(root, relPath);
	try {
		parseJsonContent(readFileSync(abs, "utf8"));
		return null;
	} catch (error) {
		return validationIssue("invalid-json", relPath, `invalid JSON: ${error}`);
	}
}

function validatePolicy(relPath: string, root: string): Issue | null {
	const abs = join(root, relPath);
	try {
		loadPolicyFile(abs, readFileSync(abs, "utf8"));
		return null;
	} catch (error) {
		return validationIssue("invalid-policy", relPath, `invalid policy: ${error}`);
	}
}

function validateShell(relPath: string, root: string): Issue | null {
	const abs = join(root, relPath);
	const shellcheck = spawnSync("shellcheck", [abs], { encoding: "utf8" });
	if (shellcheck.status === 0) return null;

	const bash = spawnSync("bash", ["-n", abs], { encoding: "utf8" });
	if (bash.status === 0) return null;

	return validationIssue(
		"invalid-shell",
		relPath,
		`shell syntax check failed: ${bash.stderr || shellcheck.stderr}`,
	);
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
	return { docs: [], code: [], skills: [], shell: [], json: [], policy: [] };
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
		state.missing.push(normalized);
		return;
	}
	const ext = extname(normalized).toLowerCase();
	if (isSkeletonYamlCandidate(normalized, ext) && !ctx.wiredPolicies.has(normalized)) {
		state.orphans.push(normalized);
		return;
	}
	const bucket = bucketFor(normalized, bucketCtx);
	if (bucket === "skip") {
		state.skipped.push(normalized);
		return;
	}
	if (bucket === "foreign-skill") {
		state.foreignSkipped.push(normalized);
		return;
	}
	state.buckets[bucket].push(normalized);
}

function classifyPaths(ctx: ClassifyContext): PathClassification {
	const state: PathClassification = {
		buckets: emptyBuckets(),
		missing: [],
		skipped: [],
		foreignSkipped: [],
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

function validateLocalBuckets(buckets: Record<BucketKey, string[]>, root: string): Issue[] {
	const diagnostics: Issue[] = [];
	for (const relPath of buckets.shell) {
		const found = validateShell(relPath, root);
		if (found) diagnostics.push(found);
	}
	for (const relPath of buckets.json) {
		const found = validateJson(relPath, root);
		if (found) diagnostics.push(found);
	}
	for (const relPath of buckets.policy) {
		const found = validatePolicy(relPath, root);
		if (found) diagnostics.push(found);
	}
	return diagnostics;
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

function discoverImpactedDocuments(input: {
	relPaths: string[];
	root: string;
	config: ReturnType<typeof loadConfig>;
	skillIndex: SkillIndex;
}): ImpactedDocument[] {
	const changed = new Set(input.relPaths.map(normalizeRelPath));
	const impacted: ImpactedDocument[] = [];
	for (const abs of collectScanFiles(input.config, input.root, input.skillIndex)) {
		const path = relPathFromAbs(abs, input.root);
		const content = readFileSync(abs, "utf8");
		const codeTargets = [
			...new Set(
				parseCodeFitMarkers(content).flatMap((marker) => marker.targets.map(normalizeRelPath)),
			),
		].sort();
		const reasons: ImpactedDocument["reasons"] = [];
		if (changed.has(path)) reasons.push({ kind: "changed-document" });
		for (const target of codeTargets) {
			if (changed.has(target)) reasons.push({ kind: "changed-code-target", target });
		}
		if (reasons.length > 0) impacted.push({ path, codeTargets, reasons });
	}
	return impacted.sort((a, b) => a.path.localeCompare(b.path));
}

function dateModeImpactDiagnostics(input: {
	config: ReturnType<typeof loadConfig>;
	impactedDocuments: ImpactedDocument[];
	relPaths: string[];
	root: string;
}): Issue[] {
	if (input.config.reviewProof) return [];
	const changed = new Set(input.relPaths.map(normalizeRelPath));
	const today = formatLocalReviewDate(new Date());
	const diagnostics: Issue[] = [];
	for (const impacted of input.impactedDocuments) {
		if (!impacted.reasons.some((reason) => reason.kind === "changed-code-target")) continue;
		const content = readFileSync(join(input.root, impacted.path), "utf8");
		if (changed.has(impacted.path) && docMetaLastReviewed(content) === today) continue;
		diagnostics.push(
			validationIssue(
				"impacted-document-review-required",
				impacted.path,
				"a linked code-fit target changed; re-read the entire document, then attest it with --fix=doc-meta --confirm-reviewed and include the document in validation",
			),
		);
	}
	return diagnostics;
}

function classificationDiagnostics(
	classification: PathClassification,
	root: string,
	base?: string,
): Issue[] {
	const diagnostics: Issue[] = [];
	for (const orphan of classification.orphans) {
		diagnostics.push(
			validationIssue(
				"orphan-policy",
				orphan,
				"file is under .skeleton/ but is not referenced by any plugin policies glob; export it from a plugin policies array or move it",
			),
		);
	}
	for (const missing of classification.missing) {
		diagnostics.push(validationIssue("missing-path", missing, "path not found"));
	}
	const audited = auditedPathCount(classification.buckets);
	if (
		(classification.skipped.length > 0 || classification.buckets.code.length > 0) &&
		audited === 0 &&
		!base
	) {
		diagnostics.push(
			validationIssue(
				"all-paths-skipped",
				".",
				`all paths were skipped (code/config). This does not verify application code.\n${codeValidationHint(root)}`,
			),
		);
	}
	return diagnostics;
}

function publicClassification(classification: PathClassification): ValidateClassificationResult {
	return {
		docs: [...classification.buckets.docs],
		code: [...classification.buckets.code],
		skills: [...classification.buckets.skills],
		shell: [...classification.buckets.shell],
		json: [...classification.buckets.json],
		policy: [...classification.buckets.policy],
		skipped: [...classification.skipped],
		foreignSkills: [...classification.foreignSkipped],
		missing: [...classification.missing],
		orphanPolicies: [...classification.orphans],
	};
}

// biome-ignore lint/complexity/useMaxParams: compact internal builder mirrors the public audit option groups
function auditOptions(
	suite: "docs" | "skills" | "self",
	root: string,
	paths: string[],
	extra: { globalOnly?: boolean; pathScopedOnly?: boolean } = {},
) {
	return {
		suite,
		strict: false,
		json: false,
		paths,
		only: null,
		root,
		...extra,
	};
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity lint/complexity/noExcessiveLinesPerFunction: branches correspond directly to public validation buckets
async function evaluateBucketAudits(input: {
	classification: PathClassification;
	root: string;
	skillIndex: SkillIndex;
	base?: string;
}): Promise<{ audits: AuditResult[]; diagnostics: Issue[] }> {
	const { classification, root, skillIndex, base } = input;
	const audits: AuditResult[] = [];
	const diagnostics = validateLocalBuckets(classification.buckets, root);

	if (base) {
		audits.push(await evaluateAudit(auditOptions("self", root, [], { globalOnly: true })));
	}
	if (classification.buckets.docs.length > 0) {
		audits.push(
			await evaluateAudit(
				auditOptions("docs", root, classification.buckets.docs, { pathScopedOnly: true }),
			),
		);
	}
	if (classification.buckets.skills.length > 0) {
		if (!base) {
			diagnostics.push(
				validationIssue(
					"full-skills-audit-required",
					classification.buckets.skills[0] ?? ".",
					"skill paths need the full skills suite; run skeleton audit skills (audit self covers docs and .skeleton; excluded skill trees still need audit skills)",
				),
			);
		} else {
			audits.push(
				await evaluateAudit(
					auditOptions("skills", root, classification.buckets.skills, {
						pathScopedOnly: true,
					}),
				),
			);
		}
	}
	if (classification.buckets.policy.length > 0) {
		if (!base) {
			diagnostics.push(
				validationIssue(
					"full-policy-audit-required",
					classification.buckets.policy[0] ?? ".",
					"policy YAML changes need full prose passes; run skeleton audit docs and skeleton audit skills",
				),
			);
		} else {
			audits.push(await evaluateAudit(auditOptions("docs", root, [])));
			const skillPaths = listSkillMarkdownPaths(root, skillIndex);
			if (skillPaths.length > 0) {
				audits.push(
					await evaluateAudit(auditOptions("skills", root, skillPaths, { pathScopedOnly: true })),
				);
			}
		}
	}
	return { audits, diagnostics };
}

function resultFor(input: {
	options: ValidateChangedOptions;
	relPaths: string[];
	classification: ValidateClassificationResult;
	impactedDocuments?: ImpactedDocument[];
	audits?: AuditResult[];
	diagnostics?: Issue[];
}): ValidateChangedResult {
	const audits = input.audits ?? [];
	const diagnostics = input.diagnostics ?? [];
	const failed =
		diagnostics.some((item) => item.severity === "error") ||
		audits.some((audit) => audit.exitCode !== 0);
	return {
		schemaVersion: 1,
		command: "validate-changed",
		ok: !failed,
		exitCode: failed ? 1 : 0,
		input: {
			paths: input.relPaths,
			staged: input.options.staged ?? false,
			...(input.options.base ? { base: input.options.base } : {}),
		},
		classification: input.classification,
		impactedDocuments: input.impactedDocuments ?? [],
		audits,
		diagnostics,
	};
}

function emptyClassification(): ValidateClassificationResult {
	return {
		docs: [],
		code: [],
		skills: [],
		shell: [],
		json: [],
		policy: [],
		skipped: [],
		foreignSkills: [],
		missing: [],
		orphanPolicies: [],
	};
}

// biome-ignore lint/complexity/noExcessiveLinesPerFunction: public evaluation keeps resolution, classification, impact discovery, and audit assembly in order
export async function evaluateValidateChanged(
	options: ValidateChangedOptions = {},
): Promise<ValidateChangedResult> {
	const root = options.root ?? findRepoRoot();
	const relPaths = resolvePaths(options);

	if (relPaths.length === 0) {
		return resultFor({ options, relPaths, classification: emptyClassification() });
	}

	const config = loadConfig(root);
	const skillIndex = buildSkillIndex(root, config.skillOwnership);
	let wiredPolicies: Set<string>;
	try {
		wiredPolicies = await collectWiredPolicyRelPaths(root, config);
	} catch (error) {
		return resultFor({
			options,
			relPaths,
			classification: emptyClassification(),
			diagnostics: [
				validationIssue(
					"plugin-load-failed",
					".",
					error instanceof Error ? error.message : String(error),
				),
			],
		});
	}

	const classification = classifyPaths({
		relPaths,
		root,
		wiredPolicies,
		skillIndex,
	});
	const impactedDocuments = discoverImpactedDocuments({ relPaths, root, config, skillIndex });
	for (const impacted of impactedDocuments) {
		if (!classification.buckets.docs.includes(impacted.path)) {
			classification.buckets.docs.push(impacted.path);
		}
	}
	classification.buckets.docs.sort();

	const diagnostics = classificationDiagnostics(classification, root, options.base);
	if (diagnostics.length > 0) {
		return resultFor({
			options,
			relPaths,
			classification: publicClassification(classification),
			impactedDocuments,
			diagnostics,
		});
	}

	const evaluated = await evaluateBucketAudits({
		classification,
		root,
		skillIndex,
		base: options.base,
	});
	evaluated.diagnostics.push(
		...dateModeImpactDiagnostics({ config, impactedDocuments, relPaths, root }),
	);
	return resultFor({
		options,
		relPaths,
		classification: publicClassification(classification),
		impactedDocuments,
		audits: evaluated.audits,
		diagnostics: evaluated.diagnostics,
	});
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: human rendering mirrors the structured result branches
export function printValidateChangedResult(result: ValidateChangedResult, json: boolean): number {
	if (json) {
		console.log(JSON.stringify(result, null, 2));
		return result.exitCode;
	}
	if (result.input.paths.length === 0) {
		console.log("validate changed: no changed files.");
		return result.exitCode;
	}
	for (const path of result.classification.foreignSkills) {
		console.log(
			`validate changed: skipping foreign skill ${path} (owned upstream; see skills-lock.json / skillOwnership)`,
		);
	}
	for (const audit of result.audits) printAuditResult(audit, false);
	for (const diagnostic of result.diagnostics) {
		const path = diagnostic.file === "." ? "" : `${diagnostic.file}: `;
		console.error(`validate changed: ${path}${diagnostic.message}`);
	}
	if (result.ok) {
		const notes: string[] = [];
		if (result.classification.code.length > 0) {
			notes.push(`${result.classification.code.length} code path(s) routed to native gates`);
		}
		if (result.classification.skipped.length > 0) {
			notes.push(`${result.classification.skipped.length} path(s) skipped`);
		}
		if (result.classification.foreignSkills.length > 0) {
			notes.push(`${result.classification.foreignSkills.length} foreign skill(s) ignored`);
		}
		console.log(`validate changed passed${notes.length > 0 ? ` (${notes.join(", ")})` : ""}.`);
	}
	return result.exitCode;
}

export async function runValidateChanged(options: ValidateChangedOptions = {}): Promise<number> {
	return printValidateChangedResult(await evaluateValidateChanged(options), options.json ?? false);
}
