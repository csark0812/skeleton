import { syncReferences, type SyncOptions, type SyncResult } from "./sync.ts";
import { runGeneratedReferencesCheck } from "./check.ts";
import { printReport } from "../audit/core/report.ts";

export interface ReferencesCheckOptions {
	root?: string;
	json?: boolean;
	strict?: boolean;
}

export function runReferencesSync(options: SyncOptions = {}): SyncResult {
	return syncReferences(options);
}

export function runReferencesCheck(
	options: ReferencesCheckOptions = {},
): number {
	const root = options.root ?? process.cwd();
	const issues = runGeneratedReferencesCheck(root);
	return printReport(issues, {
		strict: options.strict,
		json: options.json,
		label: "References check",
	});
}

export function printSyncResult(result: SyncResult): void {
	if (result.written.length > 0) {
		console.log(`references sync: wrote ${result.written.length} file(s)`);
		for (const file of result.written) console.log(`  + ${file}`);
	}
	if (result.rewritten.length > 0) {
		console.log(
			`references sync: rewrote links in ${result.rewritten.length} file(s)`,
		);
		for (const file of result.rewritten) console.log(`  ~ ${file}`);
	}
	if (result.removed.length > 0) {
		console.log(
			`references sync: removed ${result.removed.length} stale file(s)`,
		);
		for (const file of result.removed) console.log(`  - ${file}`);
	}
	if (
		result.written.length === 0 &&
		result.rewritten.length === 0 &&
		result.removed.length === 0
	) {
		console.log(
			`references sync: up to date (${result.skipped.length} file(s) checked)`,
		);
	}
}
