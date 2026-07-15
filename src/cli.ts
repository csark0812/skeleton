#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { findRepoRoot } from "./audit/config/load.ts";
import { parseAuditArgs, runAudit } from "./audit/run.ts";
import { resolveCustomizeFromRoot } from "./customize/resolve.ts";
import { runCustomizeHook } from "./hooks/run.ts";
import { runInit } from "./init/init.ts";
import { parseInitArgs } from "./init/parse-args.ts";
import { parseBuildPluginArgs, runBuildPlugin } from "./plugins/build.ts";
import { printSyncResult, runReferencesCheck, runReferencesSync } from "./references/run.ts";
import { registerPath } from "./register.ts";
import { runValidateChanged } from "./validate/changed.ts";

function usage(): void {
	console.error(`Usage: skeleton <command>

Commands:
  init [--force-hooks] [--skills] [--no-skills] [skills add flags…]
  audit docs|self|skills [--strict] [--json] [--paths=a,b] [--only=rule]
                         [--fix[=doc-meta|anchors]] [--dry-run]
  build-plugin [path] [--check]
  validate changed [paths…] [--staged] [--base <ref>]
  register <path> [--topic=…] [--dry-run] [--json]
  customize resolve <slug> [--json]
  hook customize            (reads a host hook payload on stdin)
  references sync [--dry-run] [--no-rewrite-links]
  references check [--json] [--strict]`);
}

function parseRegisterArgs(argv: string[]): {
	path: string | null;
	topic?: string;
	dryRun: boolean;
	json: boolean;
} {
	let path: string | null = null;
	let topic: string | undefined;
	let dryRun = false;
	let json = false;

	for (const arg of argv) {
		if (arg === "--dry-run") dryRun = true;
		else if (arg === "--json") json = true;
		else if (arg.startsWith("--topic=")) topic = arg.slice("--topic=".length);
		else if (!arg.startsWith("-") && !path) path = arg;
	}

	return { path, topic, dryRun, json };
}

async function main(): Promise<void> {
	const argv = process.argv.slice(2);
	const command = argv[0];

	if (!command || command === "--help" || command === "-h") {
		usage();
		process.exit(command ? 0 : 1);
	}

	try {
		if (command === "audit") {
			const sub = argv[1];
			if (sub !== "docs" && sub !== "self" && sub !== "skills") {
				usage();
				process.exit(1);
			}
			const options = parseAuditArgs(argv.slice(2));
			options.suite = sub;
			process.exit(await runAudit(options));
		}

		if (command === "build-plugin") {
			const { entry, check } = parseBuildPluginArgs(argv.slice(1));
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
			process.exit(0);
		}

		if (command === "validate" && argv[1] === "changed") {
			const rest = argv.slice(2);
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

			process.exit(await runValidateChanged({ paths, staged, base }));
		}

		if (command === "register") {
			const opts = parseRegisterArgs(argv.slice(1));
			if (!opts.path) {
				console.error("register: path required");
				process.exit(1);
			}
			registerPath({
				path: opts.path,
				topic: opts.topic,
				dryRun: opts.dryRun,
				json: opts.json,
			});
			process.exit(0);
		}

		if (command === "customize" && argv[1] === "resolve") {
			const slug = argv[2];
			const json = argv.includes("--json");
			if (!slug) {
				console.error("customize resolve: slug required");
				process.exit(1);
			}
			const result = resolveCustomizeFromRoot(slug);
			if (json) {
				console.log(JSON.stringify(result, null, 2));
			} else if (result.content) {
				process.stdout.write(result.content);
			}
			process.exit(0);
		}

		if (command === "hook") {
			if (argv[1] !== "customize") {
				usage();
				process.exit(1);
			}
			process.stdout.write(runCustomizeHook(readFileSync(0, "utf8")));
			process.exit(0);
		}

		if (command === "init") {
			const parsed = parseInitArgs(argv.slice(1));
			runInit(parsed);
			process.exit(0);
		}

		if (command === "references") {
			const sub = argv[1];
			if (sub === "sync") {
				const dryRun = argv.includes("--dry-run");
				const rewriteLinks = !argv.includes("--no-rewrite-links");
				const result = runReferencesSync({ dryRun, rewriteLinks });
				printSyncResult(result);
				process.exit(0);
			}
			if (sub === "check") {
				process.exit(
					runReferencesCheck({
						json: argv.includes("--json"),
						strict: argv.includes("--strict"),
					}),
				);
			}
			usage();
			process.exit(1);
		}

		usage();
		process.exit(1);
	} catch (error) {
		console.error(String(error));
		process.exit(1);
	}
}

void main();
