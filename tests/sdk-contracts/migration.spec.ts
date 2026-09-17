import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { customAgent } from "@post-print/agent-harness";
import { describe, expect } from "@post-print/agent-test";
import { documentationEvidence } from "../../scripts/efficacy/documents.ts";
import {
	codeReviewSchema,
	comparisonSchema,
	reviewInstructions,
	reviewSchema,
	transcript,
} from "../../scripts/efficacy/judge.ts";
import { assessRun, measureReliability } from "../../scripts/efficacy/measurements.ts";
import { checkRegression } from "../../scripts/efficacy/regression.ts";
import { stageBillingChange } from "../../scripts/efficacy/workspace.ts";

const taskPrompt = "Report the staged billing endpoint.";
const adapter = fileURLToPath(new URL("./adapter.mjs", import.meta.url));
const prompt = `${reviewInstructions}\nThe transcript must show the staged v2 billing endpoint.`;
const test = describe("Offline v2 migration contracts", ({ agent, judge }) => ({
	baseline: agent({ workspace: "tests/fixtures/efficacy/drift/control" }).setup(stageBillingChange),
	withSkeleton: agent({ workspace: "tests/fixtures/efficacy/drift/skeleton" }).setup(
		stageBillingChange,
	),
	failedAgent: agent({
		agent: customAgent({ adapter, options: { executionFailure: true } }),
		workspace: "tests/fixtures/efficacy/drift/control",
	}).setup(stageBillingChange),
	singleReviewer: judge({ prompt, schema: reviewSchema }),
	incorrectReviewer: judge({
		agent: customAgent({ adapter, options: { incorrect: true } }),
		prompt,
		schema: reviewSchema,
	}),
	codeReviewer: judge({
		agent: customAgent({ adapter, options: { codeReview: true } }),
		prompt,
		schema: codeReviewSchema,
	}),
	reviewer: judge({ prompt, schema: comparisonSchema }),
	malformed: judge({
		agent: customAgent({ adapter, options: { malformed: true } }),
		prompt,
		schema: comparisonSchema,
	}),
}));

test("passes only transcripts to the judge and keeps usage separate", async ({
	baseline,
	withSkeleton,
	reviewer,
}) => {
	const [without, withTool] = await Promise.all([
		baseline.run({ prompt: taskPrompt }),
		withSkeleton.run({ prompt: taskPrompt }),
	]);
	expect(without.workspace.root).not.toBe(withTool.workspace.root);
	for (const run of [without, withTool]) {
		expect(run.startingContext.includeGlobalSkills).toBe(false);
		expect(run.workspace.changedPaths).toEqual([]);
		expect(run.workspace.initial.files["src/billing.ts"]).toEqual(
			run.workspace.final.files["src/billing.ts"],
		);
	}
	const input = { baseline: transcript(without), withSkeleton: transcript(withTool) };
	const review = await reviewer.run({ input });
	expect(review.output.baseline.correct).toBe(true);
	expect(review.output.withSkeleton.correct).toBe(true);
	expect(withTool.usage.tokens.total).toBe(85);
	expect(without.usage.tokens.total).toBe(100);
	expect(review.usage.tokens.total).toBe(999999);
	const again = await baseline.run({ prompt: taskPrompt });
	expect([without.workspace.root, withTool.workspace.root]).not.toContain(again.workspace.root);
	expect(readFileSync("tests/fixtures/efficacy/drift/control/src/billing.ts", "utf8")).toContain(
		"/v1/",
	);
});

test("keeps malformed judge output as an error", async ({ baseline, malformed }) => {
	const run = await baseline.run({ prompt: taskPrompt });
	await expect(
		malformed.run({ input: { baseline: transcript(run), withSkeleton: transcript(run) } }),
	).rejects.toThrow();
});

test("requires a correctness verdict for both runs", async () => {
	const verdict = { correct: true, reason: "Supported by tool output" };
	expect(comparisonSchema.safeParse({ baseline: verdict }).success).toBe(false);
	expect(
		comparisonSchema.safeParse({ baseline: verdict, withSkeleton: { reason: "No evidence" } })
			.success,
	).toBe(false);
	expect(
		comparisonSchema.parse({
			baseline: verdict,
			withSkeleton: { correct: false, reason: "No evidence" },
		}).withSkeleton.correct,
	).toBe(false);
});

test("records real SDK failures and incorrect verdicts without stopping later pairs", async ({
	baseline,
	withSkeleton,
	failedAgent,
	singleReviewer,
	incorrectReviewer,
	malformed,
}, info) => {
	let pair = 0;
	const report = await measureReliability(
		info,
		async () => {
			const index = pair++;
			const [left, right] = await Promise.allSettled([
				(index === 0 ? failedAgent : baseline).run({ prompt: taskPrompt }),
				withSkeleton.run({ prompt: taskPrompt }),
			]);
			const baselineOutcome = await assessRun(left, async (run) => {
				if (index === 1) await malformed.run({ input: transcript(run) });
				const review = await singleReviewer.run({ input: transcript(run) });
				return { checks: { answer: review.output.correct }, reason: review.output.reason };
			});
			const skeletonOutcome = await assessRun(right, async (run) => {
				const review = await (index === 0 ? incorrectReviewer : singleReviewer).run({
					input: transcript(run),
				});
				return { checks: { answer: review.output.correct }, reason: review.output.reason };
			});
			return { baseline: baselineOutcome, withSkeleton: skeletonOutcome };
		},
		3,
	);
	expect(pair).toBe(3);
	expect(report.baseline).toMatchObject({
		correct: 1,
		incorrect: 0,
		executionErrors: 1,
		evaluationErrors: 1,
	});
	expect(report.withSkeleton).toMatchObject({ correct: 2, incorrect: 1 });
	expect(report.paired).toMatchObject({ bothCorrect: 1, unassessed: 2 });
	expect(report.efficiency).toMatchObject({ pairs: 1, baselineMedian: 100, skeletonMedian: 85 });
});

test("keeps documentation and verification verdicts separate without passing regressions to the judge", async ({
	baseline,
	codeReviewer,
}, info) => {
	const [execution] = await Promise.allSettled([baseline.run({ prompt: taskPrompt })]);
	const outcome = await assessRun(execution, async (run) => {
		const regression = await checkRegression(info, "change-code-without-doc-reminder", run);
		const review = await codeReviewer.run({
			input: {
				transcript: transcript(run),
				document: documentationEvidence(run, "docs/billing-webhooks.md"),
			},
		});
		return {
			checks: {
				regression: regression.passed,
				documentation: review.output.documentationCorrect,
				verification: review.output.verificationAdequate,
			},
			reason: review.output.reason,
		};
	});
	expect(outcome.status).toBe("incorrect");
	expect(outcome.checks).toEqual({ regression: false, documentation: true, verification: false });
});
