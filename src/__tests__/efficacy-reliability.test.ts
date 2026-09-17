import { describe, expect, it } from "bun:test";
import { codeReviewSchema } from "../../scripts/efficacy/judge.ts";
import {
	assessRun,
	measureReliability,
	type Outcome,
	type Pair,
	summarizeReliability,
} from "../../scripts/efficacy/measurements.ts";

const completed = (total: number | undefined = 100) => ({
	status: "fulfilled" as const,
	value: { id: "test", durationMs: 1, usage: { tokens: { total: total as number | undefined } } },
});
const correct = (tokens = 100): Outcome => ({ status: "correct", reason: "Supported", tokens });
const incorrect = (): Outcome => ({ status: "incorrect", reason: "Wrong answer", tokens: 1 });

describe("reliability and efficiency measurements", () => {
	it("records incorrect work and both kinds of errors, then continues all repetitions", async () => {
		const attachments: string[] = [];
		const expected: Pair[] = [
			{ baseline: incorrect(), withSkeleton: correct(85) },
			{
				baseline: { status: "execution-error", reason: "Provider unavailable" },
				withSkeleton: correct(85),
			},
			{
				baseline: correct(),
				withSkeleton: { status: "evaluation-error", reason: "Malformed judge output" },
			},
			{ baseline: correct(), withSkeleton: correct(85) },
			{ baseline: correct(), withSkeleton: incorrect() },
			{ baseline: incorrect(), withSkeleton: incorrect() },
		];
		let index = 0;
		const report = await measureReliability(
			{
				attach: async (name) => {
					attachments.push(name);
				},
			},
			async () => expected[index++]!,
			expected.length,
		);
		expect(index).toBe(6);
		expect(attachments).toContain("pair-6");
		expect(attachments.at(-1)).toBe("reliability-report");
		expect(report.baseline).toMatchObject({
			attempted: 6,
			evaluated: 5,
			correct: 3,
			incorrect: 2,
			executionErrors: 1,
			evaluationErrors: 0,
			evaluatedSuccessRate: 0.6,
			successfulAttemptRate: 0.5,
		});
		expect(report.withSkeleton).toMatchObject({ correct: 3, incorrect: 2, evaluationErrors: 1 });
		expect(report.paired).toEqual({
			bothCorrect: 1,
			onlyBaselineCorrect: 1,
			onlySkeletonCorrect: 1,
			neitherCorrect: 1,
			unassessed: 2,
		});
		expect(report.efficiency).toMatchObject({ pairs: 1, baselineMedian: 100, skeletonMedian: 85 });
		expect(report.efficiency.savingsFraction).toBeCloseTo(0.15);
	});

	it("uses only matched correct pairs, never cheap failures, in token savings", () => {
		const report = summarizeReliability([
			{ baseline: correct(100), withSkeleton: correct(80) },
			{ baseline: incorrect(), withSkeleton: correct(9000) },
			{ baseline: correct(8000), withSkeleton: incorrect() },
			{ baseline: correct(200), withSkeleton: correct(100) },
		]);
		expect(report.efficiency.tokens).toEqual({ baseline: [100, 200], withSkeleton: [80, 100] });
		expect(report.efficiency.savingsFraction).toBeCloseTo(0.4);
	});

	it("classifies provider failures separately and does not evaluate them", async () => {
		let evaluated = false;
		const outcome = await assessRun(
			{ status: "rejected", reason: new Error("Provider unavailable") },
			async () => {
				evaluated = true;
				return { checks: { answer: true }, reason: "ok" };
			},
		);
		expect(evaluated).toBe(false);
		expect(outcome).toEqual({ status: "execution-error", reason: "Provider unavailable" });
		const malformed = await assessRun(completed(), async () => {
			throw new Error("Invalid judge JSON");
		});
		expect(malformed).toMatchObject({
			status: "evaluation-error",
			reason: "Invalid judge JSON",
			tokens: 100,
		});
	});

	it("requires regression, documentation, and agent verification independently", async () => {
		for (const checks of [
			{ regression: false, documentation: true, verification: true },
			{ regression: true, documentation: false, verification: true },
			{ regression: true, documentation: true, verification: false },
			{ regression: true, documentation: true, verification: true },
		]) {
			const outcome = await assessRun(completed(), async () => ({ checks, reason: "Evidence" }));
			expect(outcome.status).toBe(Object.values(checks).every(Boolean) ? "correct" : "incorrect");
			expect(outcome.checks).toEqual(checks);
		}
		expect(
			codeReviewSchema.safeParse({ documentationCorrect: true, reason: "Missing verification" })
				.success,
		).toBe(false);
	});

	it("keeps missing tokens separate from correctness and excludes incomplete measurements", async () => {
		for (const total of [undefined, NaN, Infinity, 0, -1]) {
			const execution = completed();
			execution.value.usage.tokens.total = total;
			const outcome = await assessRun(execution, async () => ({
				checks: { answer: true },
				reason: "Correct",
			}));
			expect(outcome.status).toBe("correct");
			expect(outcome.tokenError).toContain("finite, positive");
			expect(outcome.tokens).toBeUndefined();
			const report = summarizeReliability([{ baseline: correct(), withSkeleton: outcome }]);
			expect(report.withSkeleton.correct).toBe(1);
			expect(report.withSkeleton.tokenErrors).toBe(1);
			expect(report.efficiency.pairs).toBe(0);
			expect(report.efficiency.savingsFraction).toBeNull();
		}
	});

	it("shows uncertainty and keeps all-error samples unevaluated", () => {
		const perfect = summarizeReliability(
			Array.from({ length: 5 }, () => ({ baseline: correct(), withSkeleton: correct() })),
		);
		expect(perfect.baseline.evaluatedSuccessWilson95?.lower).toBeCloseTo(0.5655, 3);
		expect(perfect.baseline.evaluatedSuccessWilson95?.upper).toBeCloseTo(1);
		const failed: Outcome = { status: "evaluation-error", reason: "Judge unavailable" };
		const unknown = summarizeReliability([{ baseline: failed, withSkeleton: failed }]);
		expect(unknown.baseline.evaluatedSuccessRate).toBeNull();
		expect(unknown.baseline.evaluatedSuccessWilson95).toBeNull();
		expect(unknown.efficiency.baselineMedian).toBeNull();
	});
});
