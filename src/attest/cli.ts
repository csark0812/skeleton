import { findRepoRoot } from "../audit/config/load.ts";
import { attestDocuments } from "../audit/core/review-proof.ts";
import { migrateAndReport } from "../audit/run.ts";

export interface AttestOptions {
	paths: string[];
	reason?: string;
	migrate: boolean;
	dryRun: boolean;
}

export const ATTEST_USAGE = `Usage: skeleton attest <document…> [--reason "<what you checked>"] [--dry-run]
       skeleton attest --migrate [--dry-run]

Record that you re-read each committed document in full against its current review-deps.
It adds one empty commit whose message carries a Skeleton-Reviewed line per document;
nothing tracked changes, so reviews never conflict. Commit your edits first.
--reason is required when a document's text did not change but its dependencies did.
--migrate moves a Skeleton 8 review lock into commit history, once. It never attests.`;

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: strict argv parsing enumerates every supported spelling and rejection
export function parseAttestArgs(argv: string[]): AttestOptions {
	const options: AttestOptions = { paths: [], migrate: false, dryRun: false };
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i] ?? "";
		if (arg === "--migrate") options.migrate = true;
		else if (arg === "--repair") {
			throw new Error(
				"attest: --repair is gone; review proof has no lock to repair. Use --migrate once.",
			);
		} else if (arg === "--dry-run") options.dryRun = true;
		else if (arg === "--reason") {
			const value = argv[++i];
			if (value === undefined) throw new Error("attest: --reason needs text");
			options.reason = value;
		} else if (arg.startsWith("--reason=")) options.reason = arg.slice("--reason=".length);
		else if (arg.startsWith("-")) throw new Error(`attest: unknown flag ${arg}`);
		else options.paths.push(...arg.split(",").filter(Boolean));
	}
	if (options.migrate && (options.paths.length > 0 || options.reason !== undefined)) {
		throw new Error("attest: --migrate takes no documents and no --reason");
	}
	if (!options.migrate && options.paths.length === 0) {
		throw new Error("attest: name the documents you re-read, or use --migrate");
	}
	return options;
}

export function runAttest(options: AttestOptions): number {
	const root = findRepoRoot();
	if (options.migrate) {
		migrateAndReport(root, options.dryRun);
		return 0;
	}
	const result = attestDocuments({
		root,
		paths: options.paths,
		reason: options.reason,
		dryRun: options.dryRun,
	});
	if (result.commit === null) {
		console.log(`would attest ${result.documents.join(", ")} with:\n\n${result.message}`);
	} else {
		console.log(`attested ${result.documents.join(", ")} in ${result.commit.slice(0, 12)}`);
	}
	return 0;
}
