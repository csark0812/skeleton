import { loadPlugins } from "../plugins/load.ts";
import { createContext } from "./core/context.ts";
import { applyFixes, parseFixKinds } from "./core/fix.ts";
import { printReport } from "./core/report.ts";
import { rulesForSuite } from "./rules/index.ts";
import { skillCountOnDisk } from "./rules/skill-index.ts";

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

export function parseAuditArgs(argv: string[]): AuditCliOptions {
	let suite = "docs";
	let strict = false;
	let json = false;
	let dryRun = false;
	let paths: string[] = [];
	let only: Set<string> | null = null;
	let fix: string | true | null = null;

	for (const arg of argv) {
		if (arg.startsWith("--suite=")) {
			suite = arg.slice("--suite=".length);
		} else if (arg === "--strict") {
			strict = true;
		} else if (arg === "--json") {
			json = true;
		} else if (arg === "--dry-run") {
			dryRun = true;
		} else if (arg === "--fix") {
			fix = true;
		} else if (arg.startsWith("--fix=")) {
			fix = arg.slice("--fix=".length);
		} else if (arg.startsWith("--paths=")) {
			paths = arg
				.slice("--paths=".length)
				.split(",")
				.map((path) => path.trim())
				.filter(Boolean);
		} else if (arg.startsWith("--only=")) {
			only = new Set(arg.slice("--only=".length).split(",").filter(Boolean));
		}
	}

	return { suite, strict, json, paths, only, fix, dryRun };
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
	rule: { global?: boolean },
	options: AuditCliOptions,
	pathScoped: boolean,
): boolean {
	if (options.globalOnly) return Boolean(rule.global);
	if (options.pathScopedOnly) return !rule.global;
	if (pathScoped && rule.global) return false;
	return true;
}

export async function runAudit(options: AuditCliOptions): Promise<number> {
	const base = createContext({
		root: options.root,
		paths: options.paths.length > 0 ? options.paths : undefined,
	});
	const loaded = await loadPlugins(base.root, base.config);
	const ctx = { ...base, policies: loaded.policies };

	if (options.fix !== null && options.fix !== undefined) {
		if (options.suite !== "docs") {
			console.error("--fix is supported only for audit docs");
			return 1;
		}
		const kinds = parseFixKinds(options.fix);
		applyFixes(ctx, { kinds, dryRun: options.dryRun });
		// Re-create path-scoped context after writes so subsequent rules see new content.
		if (!options.dryRun) {
			const refreshed = createContext({
				root: options.root,
				paths: options.paths.length > 0 ? options.paths : undefined,
				policies: loaded.policies,
			});
			Object.assign(ctx, refreshed);
		}
	}

	const rules = rulesForSuite(options.suite, loaded.rules).filter(
		(r) => !options.only || options.only.has(r.id),
	);

	const pathScoped = options.paths.length > 0 && !options.globalOnly;
	const issues = [];
	for (const rule of rules) {
		if (!shouldRunRule(rule, options, pathScoped)) continue;
		issues.push(...rule.run(ctx));
	}

	const label = labelForSuite(options.suite);
	return printReport(issues, {
		strict: options.strict,
		json: options.json,
		label,
		fileCount: options.suite === "docs" || options.suite === "self" ? ctx.files.length : undefined,
		successSuffix:
			options.suite === "skills" ? ` (${skillCountOnDisk(ctx)} skills on disk)` : undefined,
	});
}
