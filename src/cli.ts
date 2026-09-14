#!/usr/bin/env node

import process from "node:process";
import { findRepoRoot } from "./audit/config/load.ts";
import { parseAuditArgs, runAudit } from "./audit/run.ts";
import { runCatalogCli } from "./catalog.ts";
import { runInit } from "./init/init.ts";
import { parseInitArgs } from "./init/parse-args.ts";
import { parseBuildPluginArgs, runBuildPlugin } from "./plugins/build.ts";
import { runValidateChanged } from "./validate/changed.ts";
import { runRoute } from "./validate/route.ts";

function usage(): void {
	console.error(`Usage: skeleton <command>

Commands:
  init [--skills] [--no-skills] [skills add flags…]
  audit docs|self|skills [--strict] [--json] [--paths=a,b] [--only=rule]
                         [--fix[=doc-meta|anchors|ssot]] [--dry-run]
                         [--confirm-reviewed (doc-meta only; requires --paths)]
  build-plugin [path] [--check]
  validate changed [paths…] [--staged] [--base <ref>]
  route [path…]                 print the lane card, or classify a path; no audit
  catalog [--check] [--strict]  write or check .skeleton/catalog.md (gitignored)
Note: \`register\` and \`customize\` were removed.`);
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: strict argv parsing enumerates every supported spelling and rejection
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
		else if (arg === "--base") {
			const value = rest[++i];
			if (!value || value.startsWith("-")) throw new Error("validate changed: --base needs a ref");
			base = value;
		} else if (arg?.startsWith("--base=")) {
			base = arg.slice("--base=".length);
			if (!base) throw new Error("validate changed: --base cannot be empty");
		} else if (arg?.startsWith("-")) throw new Error(`validate changed: unknown flag ${arg}`);
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
	for (const arg of argv) {
		if (arg !== "--check" && arg !== "--strict") {
			throw new Error(`catalog: unknown flag ${arg}`);
		}
	}
	return runCatalogCli({ check: argv.includes("--check"), strict: argv.includes("--strict") });
}

function handleRemovedOverlay(command: string): number {
	console.error(`${command}: removed — overlay inject is gone. Edit the skill in its owning repo.`);
	return 1;
}

function handleInit(argv: string[]): number {
	runInit(parseInitArgs(argv));
	return 0;
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
		case "route":
			if (rest.some((arg) => arg.startsWith("-"))) {
				throw new Error("route: unknown flag");
			}
			return runRoute({ paths: rest });
		case "register":
			return handleRegister();
		case "catalog":
			return handleCatalog(rest);
		case "customize":
			return handleRemovedOverlay(command);
		case "init":
			return handleInit(rest);
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
