import type { Run } from "@post-print/agent-test";
import { describe, expect } from "@post-print/agent-test";
import { reviewInstructions, reviewSchema, transcript } from "../../scripts/efficacy/judge.ts";
import { assessRun, measureReliability } from "../../scripts/efficacy/measurements.ts";

const prompt =
	"I'm about to touch billing webhooks. Tell me the important current constraints and where they live.";
const test = describe("Does Skeleton help?", ({ agent, judge }) => ({
	baseline: agent({ workspace: "tests/fixtures/efficacy/efficiency/control" }),
	withSkeleton: agent({ workspace: "tests/fixtures/efficacy/efficiency/package-head" }),
	answer: judge({
		prompt: `${reviewInstructions}
The run must meet these requirements:
The answer identifies MAX_RETRIES=1 in src/billing/delivery.ts, the Idempotency-Key header in src/billing/idempotency.ts, and BILLING_WEBHOOK_V2 in src/deployment/billing-rollout.ts.
Each fact has its correct owning path and agrees with the repository.
It invents no runtime or deployment facts.`,
		schema: reviewSchema,
	}),
}));

test("Skeleton reliability and token efficiency when finding billing rules", async ({
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
	const savingsRatio = report.attempts === 1 ? 1 : 0.85;
	expect(
		report.efficiency.skeletonMedian!,
		report.attempts === 1
			? "Skeleton uses fewer median tokens in the diagnostic pair"
			: "Skeleton uses at least 15% fewer median tokens",
	).toBeLessThan(report.efficiency.baselineMedian! * savingsRatio);
});
