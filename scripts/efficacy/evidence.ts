import type { QualificationCorpus, QualificationCorpusTask } from "./corpus.ts";
import type { QualificationOutcome, QualificationPair } from "./qualification.ts";

export type CellAttemptEvidence = {
	attempt: number;
	executionIds: string[];
	baseline: PublicOutcomeEvidence;
	withSkeleton: PublicOutcomeEvidence;
};

export type PublicOutcomeEvidence = Pick<
	QualificationOutcome,
	| "status"
	| "runId"
	| "tokens"
	| "tokenError"
	| "durationMs"
	| "diagnostics"
	| "retry"
	| "checks"
	| "setupTokens"
	| "maintenanceTokens"
	| "setupVerified"
>;

export type QualificationCellEvidence = {
	id: string;
	repository: string;
	repositoryUrl: string;
	commit: string;
	tree: string;
	license: string;
	upstreamUrl: string;
	tier: QualificationCorpusTask["tier"];
	promptSha256: string;
	verifierSha256: string;
	attempts: CellAttemptEvidence[];
};

/** Public, commit-publishable provenance and per-attempt measurements for every manifest cell. */
export function qualificationCellEvidence(
	corpus: QualificationCorpus,
	results: Array<{ id: string; pairs: QualificationPair[] }>,
): QualificationCellEvidence[] {
	return corpus.tasks.map((task) => {
		const result = results.find((candidate) => candidate.id === task.id);
		return {
			id: task.id,
			repository: task.repository,
			repositoryUrl: task.repositoryUrl,
			commit: task.commit,
			tree: task.tree,
			license: task.license,
			upstreamUrl: task.upstreamUrl,
			tier: task.tier,
			promptSha256: task.promptSha256,
			verifierSha256: task.verifierSha256,
			attempts: (result?.pairs ?? []).map((pair, index) => attemptEvidence(pair, index + 1)),
		};
	});
}

function attemptEvidence(pair: QualificationPair, attempt: number): CellAttemptEvidence {
	const baseline = publicOutcome(pair.baseline);
	const withSkeleton = publicOutcome(pair.withSkeleton);
	return {
		attempt,
		executionIds: [
			baseline.runId,
			baseline.diagnostics?.judgeRunId,
			withSkeleton.runId,
			withSkeleton.diagnostics?.judgeRunId,
		].filter(
			(value, index, values): value is string =>
				value !== undefined && values.indexOf(value) === index,
		),
		baseline,
		withSkeleton,
	};
}

function publicOutcome(outcome: QualificationOutcome): PublicOutcomeEvidence {
	return {
		status: outcome.status,
		...(outcome.runId === undefined ? {} : { runId: outcome.runId }),
		...(outcome.tokens === undefined ? {} : { tokens: outcome.tokens }),
		...(outcome.tokenError === undefined ? {} : { tokenError: outcome.tokenError }),
		...(outcome.durationMs === undefined ? {} : { durationMs: outcome.durationMs }),
		...(outcome.diagnostics === undefined ? {} : { diagnostics: outcome.diagnostics }),
		...(outcome.retry === undefined ? {} : { retry: outcome.retry }),
		...(outcome.checks === undefined ? {} : { checks: outcome.checks }),
		...(outcome.setupTokens === undefined ? {} : { setupTokens: outcome.setupTokens }),
		...(outcome.maintenanceTokens === undefined
			? {}
			: { maintenanceTokens: outcome.maintenanceTokens }),
		...(outcome.setupVerified === undefined ? {} : { setupVerified: outcome.setupVerified }),
	};
}
