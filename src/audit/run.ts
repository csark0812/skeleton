import { refreshLocalCatalog } from "../catalog.ts";
import { loadPlugins } from "../plugins/load.ts";
import type { AuditResult, CatalogStatus } from "../result-types.ts";
import { createContext } from "./core/context.ts";
import { applyFixes, fixKindsForOnly, parseFixKinds, removedFixKindError } from "./core/fix.ts";
import type { FileSource } from "./core/repo-files.ts";
import { finalizeIssues, issue, printReport } from "./core/report.ts";
import { rulesForSuite } from "./rules/index.ts";
import { skillAuditSuffix } from "./rules/skill-index.ts";

export interface AuditCliOptions {
	suite: string;
	strict: boolean;
	json: boolean;
	paths: string[];
	only: Set<string> | null;
	root?: string;
	globalOnly?: boolean;
	pathScopedOnly?: boolean;
	fix?: string | true | null;
	dryRun?: boolean;
	fileSource?: FileSource;
}

function parseFixArg(argv: string[], index: number): { fix: string | true; nextIndex: number } {
	const next = argv[index + 1];
	if (next && !next.startsWith("-")) {
		const removed = removedFixKindError(next);
		if (removed) throw removed;
		if (!["anchors", "ssot"].includes(next)) {
			throw new Error(`Unknown --fix kind: ${next}. Use --fix, --fix=anchors, or --fix=ssot.`);
		}
		return { fix: next, nextIndex: index + 1 };
	}
	return { fix: true, nextIndex: index };
}

interface ApplyAuditFlagInput {
	state: AuditCliOptions;
	arg: string;
	argv: string[];
	index: number;
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity lint/complexity/noExcessiveLinesPerFunction: one strict parser keeps accepted audit flags visible together
function applyAuditFlag(input: ApplyAuditFlagInput): number {
	const { state, arg, argv, index } = input;
	if (arg.startsWith("--suite=")) {
		const suite = arg.slice("--suite=".length);
		if (!suite) throw new Error("audit: --suite cannot be empty");
		state.suite = suite;
		return index;
	}
	if (arg === "--strict") {
		state.strict = true;
		return index;
	}
	if (arg === "--json") {
		state.json = true;
		return index;
	}
	if (arg === "--dry-run") {
		state.dryRun = true;
		return index;
	}
	if (arg === "--confirm-reviewed" || arg === "--reason" || arg.startsWith("--reason=")) {
		throw new Error(`audit: ${arg.split("=")[0]} was removed in Skeleton 9 with review proof`);
	}
	if (arg.startsWith("--dry-run=")) {
		throw new Error("audit: use --dry-run (boolean flag), not --dry-run=<value>");
	}
	if (arg === "--fix") {
		const parsed = parseFixArg(argv, index);
		state.fix = parsed.fix;
		return parsed.nextIndex;
	}
	if (arg.startsWith("--fix=")) {
		const fix = arg.slice("--fix=".length);
		if (!fix) throw new Error("audit: --fix cannot be empty");
		state.fix = fix;
		return index;
	}
	if (arg.startsWith("--paths=")) {
		const paths = arg
			.slice("--paths=".length)
			.split(",")
			.map((path) => path.trim())
			.filter(Boolean);
		if (paths.length === 0) throw new Error("audit: --paths cannot be empty");
		state.paths = paths;
		return index;
	}
	if (arg.startsWith("--only=")) {
		const only = arg.slice("--only=".length).split(",").filter(Boolean);
		if (only.length === 0) throw new Error("audit: --only cannot be empty");
		state.only = new Set(only);
		return index;
	}
	throw new Error(
		arg.startsWith("-") ? `audit: unknown flag ${arg}` : `audit: unexpected argument ${arg}`,
	);
}

export function parseAuditArgs(argv: string[]): AuditCliOptions {
	const state: AuditCliOptions = {
		suite: "docs",
		strict: false,
		json: false,
		dryRun: false,
		paths: [],
		only: null,
		fix: null,
	};

	for (let i = 0; i < argv.length; i++) {
		i = applyAuditFlag({ state, arg: argv[i] ?? "", argv, index: i });
	}
	if (typeof state.fix === "string") {
		const removed = removedFixKindError(state.fix);
		if (removed) throw removed;
	}

	return state;
}

function labelForSuite(suite: string): string {
	switch (suite) {
		case "docs":
			return "Doc audit";
		case "skills":
			return "Skill index audit";
		case "self":
			return "Self audit";
		default:
			return "Audit";
	}
}

function catalogStatusFor(root: string, suite: string): CatalogStatus {
	if (suite !== "docs" && suite !== "self") return "not-applicable";
	return refreshLocalCatalog(root);
}

function buildAuditResult(input: {
	options: AuditCliOptions;
	issues: ReturnType<typeof finalizeIssues>;
	executed: string[];
	fileCount?: number;
	catalogStatus: CatalogStatus;
	successSuffix?: string;
}): AuditResult {
	const diagnostics = finalizeIssues(input.issues, input.options.strict);
	const errors = diagnostics.filter((item) => item.severity === "error").length;
	const warnings = diagnostics.filter((item) => item.severity === "warning").length;
	return {
		schemaVersion: 1,
		command: "audit",
		ok: errors === 0,
		exitCode: errors === 0 ? 0 : 1,
		suite: input.options.suite,
		strict: input.options.strict,
		label: labelForSuite(input.options.suite),
		scope: {
			paths: [...input.options.paths],
			...(input.fileCount === undefined ? {} : { fileCount: input.fileCount }),
		},
		rules: {
			requested: input.options.only ? [...input.options.only].sort() : null,
			executed: input.executed,
		},
		counts: { errors, warnings },
		diagnostics,
		catalog: { status: input.catalogStatus },
		...(input.successSuffix ? { successSuffix: input.successSuffix } : {}),
	};
}

function selectionFailure(input: {
	options: AuditCliOptions;
	message: string;
	catalogStatus: CatalogStatus;
}): AuditResult {
	const { options, message, catalogStatus } = input;
	return buildAuditResult({
		options,
		issues: [issue("cli-selection", ".", { message, severity: "error" })],
		executed: [],
		catalogStatus,
	});
}

function shouldRunRule(
	rule: { global?: boolean; alwaysRun?: boolean },
	options: AuditCliOptions,
	pathScoped: boolean,
): boolean {
	if (options.globalOnly) return Boolean(rule.global);
	if (options.pathScopedOnly) return !rule.global || Boolean(rule.alwaysRun);
	if (pathScoped && rule.global && !rule.alwaysRun) return false;
	return true;
}

async function runAuditFixes(
	options: AuditCliOptions,
	ctx: ReturnType<typeof createContext>,
	loaded: Awaited<ReturnType<typeof loadPlugins>>,
): Promise<number | null> {
	if (options.fix === null || options.fix === undefined) return null;
	if (options.suite !== "docs") {
		console.error("--fix is supported only for audit docs");
		return 1;
	}
	const kinds = fixKindsForOnly(parseFixKinds(options.fix), options.only);
	if (kinds.length === 0) {
		console.error("--fix has no overlapping rules with --only (anchors → links, ssot → ssot).");
		return 1;
	}
	applyFixes(ctx, { kinds, dryRun: options.dryRun });
	if (!options.dryRun) {
		const refreshed = createContext({
			root: options.root,
			paths: options.paths.length > 0 ? options.paths : undefined,
			policies: loaded.policies,
		});
		Object.assign(ctx, refreshed);
	}
	return null;
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity lint/complexity/noExcessiveLinesPerFunction: staged plugin, fix, selection, and rule orchestration follows public execution order
export async function evaluateAudit(options: AuditCliOptions): Promise<AuditResult> {
	const pathScoped = options.paths.length > 0;
	const base = createContext({
		root: options.root,
		paths: pathScoped ? options.paths : undefined,
		includeExcludedSkillTrees: options.suite === "skills" && !pathScoped,
		fileSource: options.fileSource,
	});
	const loaded = await loadPlugins(base.root, base.config);
	const ctx = { ...base, policies: loaded.policies };
	const catalogStatus = catalogStatusFor(ctx.root, options.suite);

	const fixExit = await runAuditFixes(options, ctx, loaded);
	if (fixExit !== null) {
		return selectionFailure({
			options,
			message: "requested autofix could not run",
			catalogStatus,
		});
	}

	const availableRules = rulesForSuite(options.suite, loaded.rules);
	if (options.only) {
		const availableIds = new Set(availableRules.map((rule) => rule.id));
		const unknown = [...options.only].filter((id) => !availableIds.has(id));
		if (unknown.length > 0) {
			return selectionFailure({
				options,
				message: `unknown --only rule(s): ${unknown.join(", ")}. Available: ${[...availableIds].sort().join(", ")}`,
				catalogStatus,
			});
		}
	}
	const rules = availableRules.filter((r) => !options.only || options.only.has(r.id));

	const skipGlobalsForPaths = pathScoped && !options.globalOnly;
	const executableRules = rules.filter((rule) => shouldRunRule(rule, options, skipGlobalsForPaths));
	if (executableRules.length === 0) {
		return selectionFailure({
			options,
			message: "selected scope executes zero rules; widen the scope or select another rule",
			catalogStatus,
		});
	}
	const issues = [];
	for (const rule of executableRules) {
		issues.push(...rule.run(ctx));
	}

	const executed = executableRules.map((rule) => rule.id);
	return buildAuditResult({
		options,
		issues,
		executed,
		fileCount: options.suite === "docs" || options.suite === "self" ? ctx.files.length : undefined,
		catalogStatus,
		successSuffix: options.suite === "skills" ? skillAuditSuffix(ctx) : undefined,
	});
}

export function printAuditResult(result: AuditResult, json: boolean): number {
	if (json) {
		console.log(JSON.stringify(result, null, 2));
		return result.exitCode;
	}
	return printReport(result.diagnostics, {
		strict: false,
		json: false,
		label: result.label,
		fileCount: result.scope.fileCount,
		successSuffix: result.successSuffix,
	});
}

export async function runAudit(options: AuditCliOptions): Promise<number> {
	return printAuditResult(await evaluateAudit(options), options.json);
}
