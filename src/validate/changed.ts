import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { basename, extname, join } from "node:path";
import { findRepoRoot, loadConfig } from "../audit/config/load.ts";
import { collectScanFiles, relPath as relPathFromAbs } from "../audit/core/collect.ts";
import { type FileSource, readRepoText } from "../audit/core/repo-files.ts";
import { type Issue, isRereadIssue, issue, printReport } from "../audit/core/report.ts";
import {
	collectReviewDependencyPatterns,
	pathHasReviewOwner,
	pathRequiresReviewCoverage,
} from "../audit/core/review-coverage.ts";
import {
	reviewDependencyMatchesPath,
	reviewDependencyPatterns,
} from "../audit/core/review-deps.ts";
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
import { refreshLocalCatalog } from "../catalog.ts";
import { collectWiredPolicyRelPaths } from "../plugins/load.ts";
import type { AuditResult } from "../result-types.ts";
import { type ChangedGitPath, gitDiffChangedFiles } from "./git-diff.ts";
import { stageRequiredDiagnostics } from "./staged.ts";

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
}

interface DocumentImpactReason {
	kind: "changed-document" | "changed-review-dependency";
	dependency?: string;
	target?: string;
}

interface ImpactedDocument {
	path: string;
	reviewDependencies: string[];
	reasons: DocumentImpactReason[];
}

interface ValidateClassificationResult {
	docs: string[];
	code: string[];
	skills: string[];
	shell: string[];
	json: string[];
	policy: string[];
	skipped: string[];
	foreignSkills: string[];
	missing: string[];
	orphanPolicies: string[];
}

interface ValidateChangedResult {
	ok: boolean;
	exitCode: 0 | 1;
	input: { paths: string[]; staged: boolean; base?: string };
	classification: ValidateClassificationResult;
	impactedDocuments: ImpactedDocument[];
	audits: AuditResult[];
	diagnostics: Issue[];
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

function rereadValidationIssue(file: string, target: string): Issue {
	return issue("validate-changed", file, {
		code: "impacted-document-review-required",
		message:
			"a linked review dependency changed; re-read the entire document, then attest it with --fix=doc-meta --confirm-reviewed and include the document in validation",
		severity: "error",
		link: target,
	});
}

function validateJson(relPath: string, root: string, fileSource: FileSource): Issue | null {
	const content = readRepoText(root, relPath, fileSource);
	if (content === null) return validationIssue("invalid-json", relPath, "path not found");
	try {
		parseJsonContent(content);
		return null;
	} catch (error) {
		return validationIssue("invalid-json", relPath, `invalid JSON: ${error}`);
	}
}

function validatePolicy(relPath: string, root: string, fileSource: FileSource): Issue | null {
	const content = readRepoText(root, relPath, fileSource);
	if (content === null) return validationIssue("invalid-policy", relPath, "path not found");
	try {
		loadPolicyFile(join(root, relPath), content);
		return null;
	} catch (error) {
		return validationIssue("invalid-policy", relPath, `invalid policy: ${error}`);
	}
}

function validateShell(relPath: string, root: string, fileSource: FileSource): Issue | null {
	if (fileSource === "index") {
		const content = readRepoText(root, relPath, fileSource);
		if (content === null) return validationIssue("invalid-shell", relPath, "path not found");
		const bash = spawnSync("bash", ["-n"], { input: content, encoding: "utf8" });
		if (bash.status === 0) return null;
		return validationIssue("invalid-shell", relPath, `shell syntax check failed: ${bash.stderr}`);
	}
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

interface ResolvedPaths {
	paths: string[];
	deleted: Set<string>;
}

function resolvePaths(options: ValidateChangedOptions): ResolvedPaths {
	if (options.paths && options.paths.length > 0) {
		return { paths: options.paths.map((p) => normalizeRelPath(p)), deleted: new Set() };
	}
	const changed: ChangedGitPath[] = gitDiffChangedFiles({
		staged: options.staged,
		base: options.base,
		root: options.root,
	});
	return {
		paths: changed.map((entry) => entry.path),
		deleted: new Set(changed.filter((entry) => entry.deleted).map((entry) => entry.path)),
	};
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

function validateLocalBuckets(
	buckets: Record<BucketKey, string[]>,
	root: string,
	fileSource: FileSource,
): Issue[] {
	const diagnostics: Issue[] = [];
	for (const relPath of buckets.shell) {
		const found = validateShell(relPath, root, fileSource);
		if (found) diagnostics.push(found);
	}
	for (const relPath of buckets.json) {
		const found = validateJson(relPath, root, fileSource);
		if (found) diagnostics.push(found);
	}
	for (const relPath of buckets.policy) {
		const found = validatePolicy(relPath, root, fileSource);
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
	fileSource: FileSource;
}): ImpactedDocument[] {
	const changed = new Set(input.relPaths.map(normalizeRelPath));
	const impacted: ImpactedDocument[] = [];
	for (const abs of collectScanFiles(input.config, input.root, input.skillIndex)) {
		const document = impactedDocumentForPath({
			abs,
			root: input.root,
			changed,
			fileSource: input.fileSource,
		});
		if (document) impacted.push(document);
	}
	return impacted.sort((a, b) => a.path.localeCompare(b.path));
}

function impactedDocumentForPath(input: {
	abs: string;
	root: string;
	changed: Set<string>;
	fileSource: FileSource;
}): ImpactedDocument | null {
	const path = relPathFromAbs(input.abs, input.root);
	const content = readRepoText(input.root, path, input.fileSource);
	if (content === null) return null;
	const reviewDependencies = reviewDependencyPatterns(content);
	const reasons = impactReasons(path, reviewDependencies, input.changed);
	return reasons.length > 0 ? { path, reviewDependencies, reasons } : null;
}

function impactReasons(
	path: string,
	reviewDependencies: string[],
	changed: Set<string>,
): ImpactedDocument["reasons"] {
	const reasons: ImpactedDocument["reasons"] = changed.has(path)
		? [{ kind: "changed-document" }]
		: [];
	for (const dependency of reviewDependencies) {
		for (const target of changed) {
			if (reviewDependencyMatchesPath(dependency, target)) {
				reasons.push({ kind: "changed-review-dependency", dependency, target });
			}
		}
	}
	return reasons;
}

function dateModeImpactDiagnostics(input: {
	config: ReturnType<typeof loadConfig>;
	impactedDocuments: ImpactedDocument[];
	relPaths: string[];
	root: string;
	fileSource: FileSource;
}): Issue[] {
	if (input.config.reviewProof) return [];
	const changed = new Set(input.relPaths.map(normalizeRelPath));
	const today = formatLocalReviewDate(new Date());
	return input.impactedDocuments.flatMap((impacted) =>
		dateModeIssuesForDocument({
			impacted,
			changed,
			today,
			root: input.root,
			fileSource: input.fileSource,
		}),
	);
}

function dateModeIssuesForDocument(input: {
	impacted: ImpactedDocument;
	changed: Set<string>;
	today: string;
	root: string;
	fileSource: FileSource;
}): Issue[] {
	const content = readRepoText(input.root, input.impacted.path, input.fileSource);
	if (!content) {
		return input.impacted.reasons
			.filter((reason) => reason.kind === "changed-review-dependency" && reason.target)
			.map((reason) => rereadValidationIssue(input.impacted.path, reason.target ?? ""));
	}
	if (input.changed.has(input.impacted.path) && docMetaLastReviewed(content) === input.today) {
		return [];
	}
	const issues: Issue[] = [];
	for (const reason of input.impacted.reasons) {
		if (reason.kind !== "changed-review-dependency" || !reason.target) continue;
		issues.push(rereadValidationIssue(input.impacted.path, reason.target));
	}
	return issues;
}

function uncoveredChangedPathDiagnostics(
	relPaths: string[],
	config: ReturnType<typeof loadConfig>,
	patterns: string[],
): Issue[] {
	return relPaths
		.map(normalizeRelPath)
		.filter((path) => pathRequiresReviewCoverage(path, config))
		.filter((path) => !pathHasReviewOwner(path, patterns))
		.map((path) =>
			validationIssue(
				"uncovered-changed-path",
				path,
				"no scanned document claims this path with review-deps. Add a review-deps marker on the owning paper.",
			),
		);
}

function classificationDiagnostics(input: {
	classification: PathClassification;
	root: string;
	base: string | undefined;
	coverageCandidateCount: number;
}): Issue[] {
	const { classification, root, base, coverageCandidateCount } = input;
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
		coverageCandidateCount === 0 &&
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
	extra: { globalOnly?: boolean; pathScopedOnly?: boolean; fileSource?: FileSource } = {},
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

async function auditSkillChanges(input: {
	skills: string[];
	root: string;
	base?: string;
	fileSource: FileSource;
}): Promise<AuditResult[]> {
	const sourceOpt = { fileSource: input.fileSource };
	if (input.skills.length === 0) return [];
	if (!input.base) {
		return [await evaluateAudit(auditOptions("skills", input.root, [], sourceOpt))];
	}
	return [
		await evaluateAudit(
			auditOptions("skills", input.root, input.skills, {
				pathScopedOnly: true,
				...sourceOpt,
			}),
		),
	];
}

async function auditPolicyChanges(input: {
	root: string;
	skillIndex: SkillIndex;
	fileSource: FileSource;
}): Promise<AuditResult[]> {
	const sourceOpt = { fileSource: input.fileSource };
	const audits = [await evaluateAudit(auditOptions("docs", input.root, [], sourceOpt))];
	const skillPaths = listSkillMarkdownPaths(input.root, input.skillIndex);
	if (skillPaths.length === 0) return audits;
	audits.push(
		await evaluateAudit(
			auditOptions("skills", input.root, skillPaths, {
				pathScopedOnly: true,
				...sourceOpt,
			}),
		),
	);
	return audits;
}

async function evaluateBucketAudits(input: {
	classification: PathClassification;
	root: string;
	skillIndex: SkillIndex;
	base?: string;
	fileSource: FileSource;
}): Promise<{ audits: AuditResult[]; diagnostics: Issue[] }> {
	const { classification, root, skillIndex, base, fileSource } = input;
	const audits: AuditResult[] = [];
	const diagnostics = validateLocalBuckets(classification.buckets, root, fileSource);
	const sourceOpt = { fileSource };

	if (base) {
		audits.push(
			await evaluateAudit(auditOptions("self", root, [], { globalOnly: true, ...sourceOpt })),
		);
	}
	if (classification.buckets.docs.length > 0) {
		audits.push(
			await evaluateAudit(
				auditOptions("docs", root, classification.buckets.docs, {
					pathScopedOnly: true,
					...sourceOpt,
				}),
			),
		);
	}
	audits.push(
		...(await auditSkillChanges({
			skills: classification.buckets.skills,
			root,
			base,
			fileSource,
		})),
	);
	if (
		classification.buckets.policy.length > 0 &&
		!diagnostics.some((item) => item.code === "invalid-policy")
	) {
		audits.push(...(await auditPolicyChanges({ root, skillIndex, fileSource })));
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
	refreshLocalCatalog(root);
	const resolvedPaths = resolvePaths(options);
	const relPaths = resolvedPaths.paths;

	if (relPaths.length === 0) {
		return resultFor({ options, relPaths, classification: emptyClassification() });
	}

	const config = loadConfig(root);
	const skillIndex = buildSkillIndex(root, config.skillOwnership);
	const fileSource: FileSource = options.staged ? "index" : "worktree";
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
	classification.missing = classification.missing.filter(
		(path) => !resolvedPaths.deleted.has(path),
	);
	const impactedDocuments = discoverImpactedDocuments({
		relPaths,
		root,
		config,
		skillIndex,
		fileSource,
	});
	for (const impacted of impactedDocuments) {
		if (!classification.buckets.docs.includes(impacted.path)) {
			classification.buckets.docs.push(impacted.path);
		}
	}
	classification.buckets.docs.sort();

	const ownerPatterns = collectReviewDependencyPatterns({
		root,
		config,
		skillIndex,
		fileSource,
	});
	const livePaths = relPaths.filter((path) => !resolvedPaths.deleted.has(path));
	const coverageCandidateCount = livePaths.filter((path) =>
		pathRequiresReviewCoverage(path, config),
	).length;
	const diagnostics = [
		...classificationDiagnostics({
			classification,
			root,
			base: options.base,
			coverageCandidateCount,
		}),
		...uncoveredChangedPathDiagnostics(livePaths, config, ownerPatterns),
		...stageRequiredDiagnostics({
			staged: options.staged ?? false,
			stagedPaths: relPaths,
			impactedDocuments: impactedDocuments.map((item) => item.path),
			config,
			root,
		}),
	];

	const evaluated = await evaluateBucketAudits({
		classification,
		root,
		skillIndex,
		base: options.base,
		fileSource,
	});
	evaluated.diagnostics.push(
		...dateModeImpactDiagnostics({ config, impactedDocuments, relPaths, root, fileSource }),
	);
	return resultFor({
		options,
		relPaths,
		classification: publicClassification(classification),
		impactedDocuments,
		audits: evaluated.audits,
		diagnostics: [...diagnostics, ...evaluated.diagnostics],
	});
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: human rendering mirrors the structured result branches
export function printValidateChangedResult(result: ValidateChangedResult): number {
	if (result.input.paths.length === 0) {
		console.log("validate changed: no changed files.");
		return result.exitCode;
	}
	for (const path of result.classification.foreignSkills) {
		console.log(
			`validate changed: skipping foreign skill ${path} (owned upstream; see skills-lock.json / skillOwnership)`,
		);
	}
	if (result.ok) {
		for (const audit of result.audits) printAuditResult(audit, false);
	} else {
		for (const audit of result.audits.filter((item) => !item.ok)) {
			printAuditResult(audit, false);
		}
	}
	const rereadDiagnostics = result.diagnostics.filter(isRereadIssue);
	const otherDiagnostics = result.diagnostics.filter((item) => !isRereadIssue(item));
	if (rereadDiagnostics.length > 0) {
		printReport(rereadDiagnostics, { label: "validate changed" });
	}
	for (const diagnostic of otherDiagnostics) {
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
	return printValidateChangedResult(await evaluateValidateChanged(options));
}
