import { createContext } from "./core/context.ts";
import { printReport } from "./core/report.ts";
import { rulesForSuite } from "./rules/index.ts";

export interface AuditCliOptions {
	suite: string;
	strict: boolean;
	json: boolean;
	paths: string[];
	only: Set<string> | null;
	root?: string;
}

export function parseAuditArgs(argv: string[]): AuditCliOptions {
	let suite = "docs";
	let strict = false;
	let json = false;
	let paths: string[] = [];
	let only: Set<string> | null = null;

	for (const arg of argv) {
		if (arg.startsWith("--suite=")) {
			suite = arg.slice("--suite=".length);
		} else if (arg === "--strict") {
			strict = true;
		} else if (arg === "--json") {
			json = true;
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

	return { suite, strict, json, paths, only };
}

function labelForSuite(suite: string): string {
	switch (suite) {
		case "docs":
			return "Doc audit";
		case "self":
			return "Self audit";
		default:
			return "Audit";
	}
}

export function runAudit(options: AuditCliOptions): number {
	const ctx = createContext({
		root: options.root,
		paths: options.paths.length > 0 ? options.paths : undefined,
	});
	const rules = rulesForSuite(options.suite).filter(
		(r) => !options.only || options.only.has(r.id),
	);

	const pathScoped = options.paths.length > 0;
	const issues = [];
	for (const rule of rules) {
		if (pathScoped && rule.global) continue;
		issues.push(...rule.run(ctx));
	}

	return printReport(issues, {
		strict: options.strict,
		json: options.json,
		label: labelForSuite(options.suite),
		fileCount:
			options.suite === "docs" || options.suite === "self"
				? ctx.files.length
				: undefined,
	});
}
