import type { Run } from "@post-print/agent-test";
import { describe, expect } from "@post-print/agent-test";
import {
	documentationEvidence,
	documentationInstructions,
} from "../../scripts/efficacy/documents.ts";
import { codeReviewSchema, reviewInstructions, transcript } from "../../scripts/efficacy/judge.ts";
import { assessRun, measureReliability } from "../../scripts/efficacy/measurements.ts";
import { checkRegression } from "../../scripts/efficacy/regression.ts";

const prompt =
	"Production .mjs files are being skipped by documentation coverage checks. Fix that while keeping generated Skeleton plugins excluded. Update docs/developer/config.md to describe both rules, verify the change, and run focused tests for production .mjs inclusion and generated-plugin exclusion.";
const test = describe("Does Skeleton help?", ({ agent, judge }) => ({
	baseline: agent({ workspace: "tests/fixtures/efficacy/history/production-javascript/control" }),
	withSkeleton: agent({
		workspace: "tests/fixtures/efficacy/history/production-javascript/skeleton",
	}),
	documentationAndVerification: judge({
		prompt: `${reviewInstructions}
${documentationInstructions}
Set documentationCorrect from the documentation and completion-claim requirements.
Set verificationAdequate from the agent-run verification requirements.
Do not grade code behavior: independent executable checks own that result.
The run must meet these requirements:
docs/developer/config.md accurately says production .mjs files receive coverage checks while generated files under .skeleton/plugins/** stay excluded.
It no longer describes a blanket .mjs exclusion.
Metadata-only edits are insufficient.
The transcript shows successful focused executable tests for production .mjs inclusion and generated-plugin exclusion on the final code.
Completion claims agree with the repository and test outputs.
The agent itself must have run the checks; independent harness checks do not satisfy this verification criterion.
The agent's local regression tests must remain meaningful and must not be disabled or weakened.`,
		schema: codeReviewSchema,
	}),
}));

test("Skeleton reliability and token efficiency when fixing production JavaScript coverage", async ({
	baseline,
	withSkeleton,
	documentationAndVerification,
}, info) => {
	const evaluate = async (run: Run) => {
		const regression = await checkRegression(info, "fix-production-javascript-coverage", run);
		const review = await documentationAndVerification.run({
			input: {
				transcript: transcript(run),
				document: documentationEvidence(run, "docs/developer/config.md"),
			},
		});
		return {
			checks: {
				regression: regression.passed,
				documentation: review.output.documentationCorrect,
				verification: review.output.verificationAdequate,
			},
			reason: [
				regression.passed ? "Regression checks passed." : regression.output,
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
