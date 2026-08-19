import { loadPlugins } from "../plugins/load.ts";
import { createContext } from "./core/context.ts";
import { applyFixes, fixKindsForOnly, parseFixKinds } from "./core/fix.ts";
import { printReport } from "./core/report.ts";
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
}

function parseFixArg(argv: string[], index: number): { fix: string | true; nextIndex: number } {
	const next = argv[index + 1];
	if (next && !next.startsWith("-")) {
		if (next !== "doc-meta" && next !== "anchors" && next !== "ssot") {
			throw new Error(
				`Unknown --fix kind: ${next}. Use --fix, --fix=doc-meta, --fix=anchors, or --fix=ssot.`,
			);
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

function applyAuditFlag(input: ApplyAuditFlagInput): number {
	const { state, arg, argv, index } = input;
	if (arg.startsWith("--suite=")) {
		state.suite = arg.slice("--suite=".length);
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
	if (arg.startsWith("--dry-run=")) {
		throw new Error("audit: use --dry-run (boolean flag), not --dry-run=<value>");
	}
	if (arg === "--fix") {
		const parsed = parseFixArg(argv, index);
		state.fix = parsed.fix;
		return parsed.nextIndex;
	}
	if (arg.startsWith("--fix=")) {
		state.fix = arg.slice("--fix=".length);
		return index;
	}
	if (arg.startsWith("--paths=")) {
		state.paths = arg
			.slice("--paths=".length)
			.split(",")
			.map((path) => path.trim())
			.filter(Boolean);
		return index;
	}
	if (arg.startsWith("--only=")) {
		state.only = new Set(arg.slice("--only=".length).split(",").filter(Boolean));
		return index;
	}
	return index;
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
		console.error(
			"--fix has no overlapping rules with --only (doc-meta → doc-meta, anchors → links, ssot → ssot).",
		);
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

export async function runAudit(options: AuditCliOptions): Promise<number> {
	const pathScoped = options.paths.length > 0;
	const base = createContext({
		root: options.root,
		paths: pathScoped ? options.paths : undefined,
		includeExcludedSkillTrees: options.suite === "skills" && !pathScoped,
	});
	const loaded = await loadPlugins(base.root, base.config);
	const ctx = { ...base, policies: loaded.policies };

	const fixExit = await runAuditFixes(options, ctx, loaded);
	if (fixExit !== null) return fixExit;

	const rules = rulesForSuite(options.suite, loaded.rules).filter(
		(r) => !options.only || options.only.has(r.id),
	);

	const skipGlobalsForPaths = pathScoped && !options.globalOnly;
	const issues = [];
	for (const rule of rules) {
		if (!shouldRunRule(rule, options, skipGlobalsForPaths)) continue;
		issues.push(...rule.run(ctx));
	}

	const label = labelForSuite(options.suite);
	return printReport(issues, {
		strict: options.strict,
		json: options.json,
		label,
		fileCount: options.suite === "docs" || options.suite === "self" ? ctx.files.length : undefined,
		successSuffix: options.suite === "skills" ? skillAuditSuffix(ctx) : undefined,
	});
}
