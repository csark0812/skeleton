import type { Run } from "@post-print/agent-test";
import { describe, expect } from "@post-print/agent-test";
import { reviewInstructions, reviewSchema, transcript } from "../../scripts/efficacy/judge.ts";
import { assessRun, measureReliability } from "../../scripts/efficacy/measurements.ts";
import { stageBillingChange } from "../../scripts/efficacy/workspace.ts";

const prompt =
	"What billing webhook URL does the staged code use, and do our docs still match? Report only; do not modify files.";
const test = describe("Does Skeleton help?", ({ agent, judge }) => ({
	baseline: agent({ workspace: "tests/fixtures/efficacy/drift/control" }).setup(stageBillingChange),
	withSkeleton: agent({ workspace: "tests/fixtures/efficacy/drift/skeleton" }).setup(
		stageBillingChange,
	),
	answer: judge({
		prompt: `${reviewInstructions}
The run must meet these requirements:
The answer identifies https://api.example.com/v2/billing/webhook in src/billing.ts, explains that docs/billing-webhooks.md still says v1, and does not claim the staged code is deployed.`,
		schema: reviewSchema,
	}),
}));

test("Skeleton reliability and token efficiency when identifying outdated billing docs", async ({
	baseline,
	withSkeleton,
	answer,
}, info) => {
	const evaluate = async (run: Run) => {
		const review = await answer.run({ input: transcript(run) });
		const unchanged = run.workspace.changedPaths.length === 0;
		return {
			checks: { unchanged, answer: review.output.correct },
			reason: [
				unchanged ? "No files changed." : `Changed files: ${run.workspace.changedPaths.join(", ")}`,
				review.output.reason,
			].join("\n"),
		};
	};
	const report = await measureReliability(info, async () => {
		const [without, withTool] = await Promise.allSettled([
			baseline.run({ prompt }),
			withSkeleton.run({ prompt }),
		]);
		const [baselineOutcome, skeletonOutcome] = await Promise.all([
			assessRun(without, evaluate),
			assessRun(withTool, evaluate),
		]);
		return { baseline: baselineOutcome, withSkeleton: skeletonOutcome };
	});

	// Preserve the acceptance bar, after recording every outcome.
	expect(report.baseline.correct, "Every baseline repetition is correct").toBe(report.attempts);
	expect(report.withSkeleton.correct, "Every Skeleton repetition is correct").toBe(report.attempts);
	expect(
		report.baseline.tokenErrors + report.withSkeleton.tokenErrors,
		"No token measurements are invalid",
	).toBe(0);
	expect(report.efficiency.pairs, "Every repetition forms a measurable efficiency pair").toBe(
		report.attempts,
	);
	if (report.attempts > 1) {
		expect(
			report.efficiency.skeletonMedian!,
			"Skeleton uses at least 15% fewer median tokens",
		).toBeLessThanOrEqual(report.efficiency.baselineMedian! * 0.85);
	}
});
