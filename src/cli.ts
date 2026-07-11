#!/usr/bin/env node

import { parseAuditArgs, runAudit } from "./audit/run.ts";

function usage(): void {
	console.error(`Usage: skeleton audit <docs|self> [--strict] [--json] [--paths=a,b] [--only=rule]

Commands:
  audit docs   Run doc audit suite against .skeleton/config.yaml scan perimeter
  audit self   Same as audit docs (full pass)`);
}

function main(): void {
	const argv = process.argv.slice(2);
	const command = argv[0];

	if (command !== "audit") {
		usage();
		process.exit(command === "--help" || command === "-h" ? 0 : 1);
	}

	const sub = argv[1];
	if (sub !== "docs" && sub !== "self") {
		usage();
		process.exit(1);
	}

	const options = parseAuditArgs(argv.slice(2));
	options.suite = sub === "self" ? "self" : "docs";
	process.exit(runAudit(options));
}

main();
