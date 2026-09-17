import type { Run } from "@post-print/agent-test";
import { describe, expect } from "@post-print/agent-test";
import {
	documentationEvidence,
	documentationInstructions,
} from "../../scripts/efficacy/documents.ts";
import { codeReviewSchema, reviewInstructions, transcript } from "../../scripts/efficacy/judge.ts";
import { assessRun, measureReliability } from "../../scripts/efficacy/measurements.ts";
import { checkOrderLimits } from "../../scripts/efficacy/order-checks.ts";

const prompt =
	"Increase the standard order limit from 20 to 30. Preserve special-category and fallback limits. Keep related documentation accurate and verify the change.";
const test = describe("Does Skeleton help?", ({ agent, judge }) => ({
	baseline: agent({ workspace: "tests/fixtures/efficacy/tradeoffs/truncated/control" }),
	withSkeleton: agent({ workspace: "tests/fixtures/efficacy/tradeoffs/truncated/skeleton" }),
	documentationAndVerification: judge({
		prompt: `${reviewInstructions}
${documentationInstructions}
Set documentationCorrect when the final docs describe standard=30, regulated=5, fallback=20 and cite the correct implementation. Set verificationAdequate when the agent ran successful meaningful tests for these cases.`,
		schema: codeReviewSchema,
	}),
}));

test("Recover when context omits the order-limit definition", async ({
	baseline,
	withSkeleton,
	documentationAndVerification,
}, info) => {
	const evaluate = async (run: Run) => {
		const regression = checkOrderLimits(run);
		await info.attach(`${run.id}-regression`, {
			body: regression.output,
			contentType: "text/plain",
		});
		const review = await documentationAndVerification.run({
			input: {
				transcript: transcript(run),
				document: documentationEvidence(run, "docs/orders.md"),
			},
		});
		return {
			checks: {
				regression: regression.passed,
				documentation: review.output.documentationCorrect,
				verification: review.output.verificationAdequate,
			},
			reason: `${regression.output}
${review.output.reason}`,
		};
	};
	const report = await measureReliability(info, async () => {
		const [left, right] = await Promise.allSettled([
			baseline.run({ prompt }),
			withSkeleton.run({ prompt }),
		]);
		const [without, withTool] = await Promise.all([
			assessRun(left, evaluate),
			assessRun(right, evaluate),
		]);
		return { baseline: without, withSkeleton: withTool };
	});
	expect(report.baseline.correct, "Every baseline repetition is correct").toBe(report.attempts);
	expect(report.withSkeleton.correct, "Every Skeleton repetition is correct").toBe(report.attempts);
	expect(report.efficiency.pairs, "Every repetition forms a measurable efficiency pair").toBe(
		report.attempts,
	);
	// Recovery cost is measured; this test does not require a speedup.
});
