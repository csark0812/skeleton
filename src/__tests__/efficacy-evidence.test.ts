import { describe, expect, it } from "bun:test";
import { parseQualificationCorpus } from "../../scripts/efficacy/corpus.ts";
import { qualificationCellEvidence } from "../../scripts/efficacy/evidence.ts";
import type { QualificationPair } from "../../scripts/efficacy/qualification.ts";

const corpus = parseQualificationCorpus(
	JSON.parse(
		await Bun.file(
			new URL("../../agent-suites/broader-openai-v1/qualification-corpus.json", import.meta.url),
		).text(),
	),
);

describe("publishable qualification evidence", () => {
	it("includes public provenance, per-pair categories, tokens, and execution ids", () => {
		const pairs: QualificationPair[] = [
			{
				baseline: {
					status: "correct",
					reason: "private trace is not exported",
					runId: "base-1",
					tokens: 100,
					diagnostics: {
						agentTurns: 3,
						agentToolCalls: 2,
						judgeRunId: "judge-base",
						judgeTokens: 12,
					},
				},
				withSkeleton: {
					status: "incorrect",
					reason: "private trace is not exported",
					runId: "skeleton-1",
					tokens: 70,
					checks: { content: false },
					diagnostics: {
						agentTurns: 4,
						agentToolCalls: 3,
						judgeRunId: "judge-skeleton",
						judgeTokens: 14,
					},
				},
			},
		];
		const [cell] = qualificationCellEvidence(corpus, [{ id: corpus.tasks[0]!.id, pairs }]);
		expect(cell).toMatchObject({
			repositoryUrl: corpus.tasks[0]!.repositoryUrl,
			upstreamUrl: corpus.tasks[0]!.upstreamUrl,
			commit: corpus.tasks[0]!.commit,
			promptSha256: corpus.tasks[0]!.promptSha256,
			verifierSha256: corpus.tasks[0]!.verifierSha256,
			attempts: [
				{
					attempt: 1,
					executionIds: ["base-1", "judge-base", "skeleton-1", "judge-skeleton"],
					baseline: {
						status: "correct",
						tokens: 100,
						diagnostics: {
							agentTurns: 3,
							agentToolCalls: 2,
							judgeRunId: "judge-base",
							judgeTokens: 12,
						},
					},
					withSkeleton: {
						status: "incorrect",
						tokens: 70,
						checks: { content: false },
						diagnostics: {
							agentTurns: 4,
							agentToolCalls: 3,
							judgeRunId: "judge-skeleton",
							judgeTokens: 14,
						},
					},
				},
			],
		});
		expect(JSON.stringify(cell)).not.toContain("private trace");
	});

	it("retains manifest cells without results rather than silently omitting them", () => {
		const cells = qualificationCellEvidence(corpus, []);
		expect(cells).toHaveLength(12);
		expect(cells.every((cell) => cell.attempts.length === 0)).toBe(true);
	});
});
