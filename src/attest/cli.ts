import { findRepoRoot } from "../audit/config/load.ts";
import { attestDocuments } from "../audit/core/review-proof.ts";
import { migrateAndReport } from "../audit/run.ts";

export interface AttestOptions {
	paths: string[];
	reason?: string;
	repair: boolean;
	dryRun: boolean;
}

export const ATTEST_USAGE = `Usage: skeleton attest <document…> [--reason "<what you checked>"] [--dry-run]
       skeleton attest --repair [--dry-run]

Record that you re-read each document in full against its current review-deps.
--reason is required when a document's text did not change but its dependencies did.
--repair migrates older proof files, resolves a merge conflict in the review lock,
and moves or removes entries of renamed or deleted documents. It never attests.`;

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: strict argv parsing enumerates every supported spelling and rejection
export function parseAttestArgs(argv: string[]): AttestOptions {
	const options: AttestOptions = { paths: [], repair: false, dryRun: false };
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i] ?? "";
		if (arg === "--repair") options.repair = true;
		else if (arg === "--dry-run") options.dryRun = true;
		else if (arg === "--reason") {
			const value = argv[++i];
			if (value === undefined) throw new Error("attest: --reason needs text");
			options.reason = value;
		} else if (arg.startsWith("--reason=")) options.reason = arg.slice("--reason=".length);
		else if (arg.startsWith("-")) throw new Error(`attest: unknown flag ${arg}`);
		else options.paths.push(...arg.split(",").filter(Boolean));
	}
	if (options.repair && (options.paths.length > 0 || options.reason !== undefined)) {
		throw new Error("attest: --repair takes no documents and no --reason");
	}
	if (!options.repair && options.paths.length === 0) {
		throw new Error("attest: name the documents you re-read, or use --repair");
	}
	return options;
}

export function runAttest(options: AttestOptions): number {
	const root = findRepoRoot();
	if (options.repair) {
		migrateAndReport(root, options.dryRun);
		return 0;
	}
	const result = attestDocuments({
		root,
		paths: options.paths,
		reason: options.reason,
		dryRun: options.dryRun,
	});
	const verb = options.dryRun ? "would attest" : "attested";
	console.log(`${verb} ${result.documents.join(", ")} in ${result.proofFile}`);
	if (!options.dryRun) console.log(`stage: ${result.modifiedFiles.join(" ")}`);
	return 0;
}
