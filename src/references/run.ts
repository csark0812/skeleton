import process from "node:process";
import { loadConfig } from "../audit/config/load.ts";
import { printReport } from "../audit/core/report.ts";
import { runGeneratedReferencesCheck } from "./check.ts";
import { type SyncOptions, type SyncResult, syncReferences } from "./sync.ts";

export interface ReferencesCheckOptions {
	root?: string;
	json?: boolean;
	strict?: boolean;
}

export function runReferencesSync(options: SyncOptions = {}): SyncResult {
	return syncReferences(options);
}

export function runReferencesCheck(options: ReferencesCheckOptions = {}): number {
	const root = options.root ?? process.cwd();
	let ownership: ReturnType<typeof loadConfig>["skillOwnership"];
	try {
		ownership = loadConfig(root).skillOwnership;
	} catch {
		ownership = undefined;
	}
	const issues = runGeneratedReferencesCheck(root, ownership);
	return printReport(issues, {
		strict: options.strict,
		json: options.json,
		label: "References check",
	});
}

function printSyncSection(label: string, files: string[], prefix: string): void {
	if (files.length === 0) return;
	console.log(label);
	for (const file of files) console.log(`  ${prefix} ${file}`);
}

export function printSyncResult(result: SyncResult): void {
	printSyncSection(`references sync: wrote ${result.written.length} file(s)`, result.written, "+");
	printSyncSection(
		`references sync: rewrote links in ${result.rewritten.length} file(s)`,
		result.rewritten,
		"~",
	);
	printSyncSection(
		`references sync: removed ${result.removed.length} stale file(s)`,
		result.removed,
		"-",
	);
	if (result.written.length === 0 && result.rewritten.length === 0 && result.removed.length === 0) {
		console.log(`references sync: up to date (${result.skipped.length} file(s) checked)`);
	}
}
