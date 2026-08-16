#!/usr/bin/env node

import { readFileSync } from "node:fs";
import process from "node:process";
import { findRepoRoot } from "./audit/config/load.ts";
import { parseAuditArgs, runAudit } from "./audit/run.ts";
import { runCatalogCli } from "./catalog.ts";
import { resolveCustomizeFromRoot } from "./customize/resolve.ts";
import { runCustomizeHook } from "./hooks/run.ts";
import { runInit } from "./init/init.ts";
import { parseInitArgs } from "./init/parse-args.ts";
import { parseBuildPluginArgs, runBuildPlugin } from "./plugins/build.ts";
import { printSyncResult, runReferencesCheck, runReferencesSync } from "./references/run.ts";
import { runValidateChanged } from "./validate/changed.ts";

function usage(): void {
	console.error(`Usage: skeleton <command>

Commands:
  init [--force-hooks] [--skills] [--no-skills] [skills add flags…]
  audit docs|self|skills [--strict] [--json] [--paths=a,b] [--only=rule]
                         [--fix[=doc-meta|anchors|ssot]] [--dry-run]
  build-plugin [path] [--check]
  validate changed [paths…] [--staged] [--base <ref>]
  catalog [--check]         write or check .skeleton/catalog.md (gitignored)
  customize resolve <slug> [--json]
  hook customize            (reads a host hook payload on stdin)
  references sync [--dry-run] [--no-rewrite-links]
  references check [--json] [--strict]

Note: \`register\` was removed — add a source-of-truth marker to the file and run \`skeleton catalog\`.`);
}

function parseValidateChangedArgs(rest: string[]): {
	paths: string[];
	staged: boolean;
	base?: string;
} {
	const paths: string[] = [];
	let staged = false;
	let base: string | undefined;

	for (let i = 0; i < rest.length; i++) {
		const arg = rest[i];
		if (arg === "--staged") staged = true;
		else if (arg === "--base") base = rest[++i];
		else if (arg?.startsWith("--base=")) base = arg.slice("--base=".length);
		else if (arg && !arg.startsWith("-")) paths.push(arg);
	}

	return { paths, staged, base };
}

async function handleAudit(argv: string[]): Promise<number> {
	const sub = argv[0];
	if (sub !== "docs" && sub !== "self" && sub !== "skills") {
		usage();
		return 1;
	}
	const options = parseAuditArgs(argv.slice(1));
	options.suite = sub;
	return runAudit(options);
}

async function handleBuildPlugin(argv: string[]): Promise<number> {
	const { entry, check } = parseBuildPluginArgs(argv);
	const root = findRepoRoot();
	const result = await runBuildPlugin({ root, entry, check });
	if (check) {
		console.log(
			result.checked.length === 0
				? "build-plugin --check: no plugins configured."
				: `build-plugin --check: ${result.checked.length} plugin(s) up to date.`,
		);
	} else {
		console.log(
			result.built.length === 0
				? "build-plugin: no plugins configured."
				: `build-plugin: built ${result.built.length} plugin(s).`,
		);
	}
	return 0;
}

async function handleValidateChanged(argv: string[]): Promise<number> {
	const { paths, staged, base } = parseValidateChangedArgs(argv);
	return runValidateChanged({ paths, staged, base });
}

function handleRegister(): number {
	console.error(
		"register: removed — add `<!-- source-of-truth: … -->` (or visible `source-of-truth:`) to the file, then run `skeleton catalog`.",
	);
	return 1;
}

function handleCatalog(argv: string[]): number {
	return runCatalogCli({ check: argv.includes("--check") });
}

function handleCustomizeResolve(argv: string[]): number {
	const slug = argv[0];
	const json = argv.includes("--json");
	if (!slug) {
		console.error("customize resolve: slug required");
		return 1;
	}
	const result = resolveCustomizeFromRoot(slug);
	if (json) {
		console.log(JSON.stringify(result, null, 2));
	} else if (result.content) {
		process.stdout.write(result.content);
	}
	return 0;
}

function handleHook(argv: string[]): number {
	if (argv[0] !== "customize") {
		usage();
		return 1;
	}
	process.stdout.write(runCustomizeHook(readFileSync(0, "utf8")));
	return 0;
}

function handleInit(argv: string[]): number {
	runInit(parseInitArgs(argv));
	return 0;
}

function handleReferences(argv: string[]): number {
	const sub = argv[0];
	if (sub === "sync") {
		const dryRun = argv.includes("--dry-run");
		const rewriteLinks = !argv.includes("--no-rewrite-links");
		const result = runReferencesSync({ dryRun, rewriteLinks });
		printSyncResult(result);
		return 0;
	}
	if (sub === "check") {
		return runReferencesCheck({
			json: argv.includes("--json"),
			strict: argv.includes("--strict"),
		});
	}
	usage();
	return 1;
}

async function dispatchCommand(argv: string[]): Promise<number | null> {
	const command = argv[0];
	const rest = argv.slice(1);

	switch (command) {
		case "audit":
			return handleAudit(rest);
		case "build-plugin":
			return handleBuildPlugin(rest);
		case "validate":
			return rest[0] === "changed" ? handleValidateChanged(rest.slice(1)) : null;
		case "register":
			return handleRegister();
		case "catalog":
			return handleCatalog(rest);
		case "customize":
			return rest[0] === "resolve" ? handleCustomizeResolve(rest.slice(1)) : null;
		case "hook":
			return handleHook(rest);
		case "init":
			return handleInit(rest);
		case "references":
			return handleReferences(rest);
		default:
			return null;
	}
}

async function main(): Promise<void> {
	const argv = process.argv.slice(2);
	const command = argv[0];

	if (!command || command === "--help" || command === "-h") {
		usage();
		process.exit(command ? 0 : 1);
	}

	try {
		const exitCode = await dispatchCommand(argv);
		if (exitCode === null) {
			usage();
			process.exit(1);
		}
		process.exit(exitCode);
	} catch (error) {
		console.error(String(error));
		process.exit(1);
	}
}

void main();
