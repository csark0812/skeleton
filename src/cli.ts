#!/usr/bin/env node

import { parseAuditArgs, runAudit } from "./audit/run.ts";
import { resolveCustomizeFromRoot } from "./customize/resolve.ts";
import { runInit } from "./init/init.ts";
import { registerPath } from "./register.ts";
import { runValidateChanged } from "./validate/changed.ts";

function usage(): void {
	console.error(`Usage: skeleton <command>

Commands:
  init [--skills] [--no-skills] [--global-skills] [--force-hooks]
  audit docs|self|skills [--strict] [--json] [--paths=a,b] [--only=rule]
  validate changed [paths…] [--staged] [--base <ref>]
  register <path> [--topic=…] [--dry-run] [--json]
  customize resolve <slug> [--json]`);
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

function main(): void {
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
			process.exit(runAudit(options));
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

			process.exit(runValidateChanged({ paths, staged, base }));
		}

		if (command === "register") {
			const opts = parseRegisterArgs(argv.slice(1));
			if (!opts.path) {
				console.error("register: path required");
				process.exit(1);
			}
			registerPath(opts);
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

		if (command === "init") {
			const forceHooks = argv.includes("--force-hooks");
			const noSkills = argv.includes("--no-skills");
			const skills = argv.includes("--skills") || argv.includes("--global-skills");
			runInit({ forceHooks, skills, noSkills, globalSkills: argv.includes("--global-skills") });
			process.exit(0);
		}

		usage();
		process.exit(1);
	} catch (error) {
		console.error(String(error));
		process.exit(1);
	}
}

main();
