import { posix } from "node:path";
import { relPath } from "../core/collect.ts";
import type { AuditContext } from "../core/context.ts";
import {
	owningPackageJson,
	packageManagerOf,
	parsePackageJson,
	quotesValue,
	scriptReferences,
	toolchainFacts,
} from "../core/package-references.ts";
import { readRepoText } from "../core/repo-files.ts";
import { type Issue, issue } from "../core/report.ts";
import { resolveSelector } from "../core/selectors.ts";

/** The instruction file that must state its package's toolchain: AGENTS.md beside package.json. */
function isToolchainOwner(docPath: string, packagePath: string): boolean {
	return (
		posix.basename(docPath) === "AGENTS.md" && posix.dirname(docPath) === posix.dirname(packagePath)
	);
}

function documentIssues(ctx: AuditContext, docPath: string): Issue[] {
	const source = ctx.fileSource ?? "worktree";
	const packagePath = owningPackageJson(ctx.root, docPath, source);
	if (packagePath === null) return [];
	const packageText = readRepoText(ctx.root, packagePath, source);
	const pkg = parsePackageJson(packageText);
	const pm = pkg ? packageManagerOf(pkg) : null;
	const markdown = readRepoText(ctx.root, docPath, source);
	if (!(pkg && pm && packageText !== null && markdown !== null)) return [];

	const issues = scriptReferences(markdown, pm)
		.filter((ref) => !resolveSelector(packagePath, packageText, `scripts.${ref.script}`).ok)
		.map((ref) =>
			issue("package-references", docPath, {
				code: "unknown-script",
				message: `\`${ref.command}\` names no script in ${packagePath}`,
				link: `line ${ref.line}`,
				remediation: `Rename the command to an existing script, or add "${ref.script}" to ${packagePath} scripts.`,
			}),
		);
	if (!isToolchainOwner(docPath, packagePath)) return issues;
	for (const fact of toolchainFacts(pkg)) {
		if (quotesValue(markdown, fact.value)) continue;
		issues.push(
			issue("package-references", docPath, {
				code: "missing-toolchain-fact",
				message: `does not quote \`${fact.value}\` from ${packagePath} ${fact.field}`,
				remediation: `State the exact value in backticks, e.g. \`${fact.value}\`.`,
			}),
		);
	}
	return issues;
}

/** Commands and toolchain facts in documents must still match the package.json that owns them. */
function runPackageReferencesRule(ctx: AuditContext): Issue[] {
	return ctx.files
		.map((abs) => relPath(abs, ctx.root))
		.filter((path) => /\.mdx?$/i.test(path))
		.flatMap((path) => documentIssues(ctx, path));
}

export const packageReferencesRule = { id: "package-references", run: runPackageReferencesRule };
