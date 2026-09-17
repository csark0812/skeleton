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
	"Validation reports uncovered-changed-path for deleted source files. Deleted paths must be excluded from both coverage-candidate counts and uncovered-path diagnostics. Files that still exist must retain coverage checks. Fix and verify the behavior.";
const test =
	describe("Skeleton reliability and token efficiency when fixing deleted-file validation", ({
		agent,
		judge,
	}) => ({
		baseline: agent({ workspace: "tests/fixtures/efficacy/history/deleted-file/control" }),
		withSkeleton: agent({ workspace: "tests/fixtures/efficacy/history/deleted-file/skeleton" }),
		documentationAndVerification: judge({
			prompt: `${reviewInstructions}
${documentationInstructions}
Set documentationCorrect from the documentation and completion-claim requirements.
Set verificationAdequate from the agent-run verification requirements.
Do not grade code behavior: independent executable checks own that result.
The run must meet these requirements:
docs/developer/validation.md says deleted files do not require an owning document for uncovered-changed-path, while live coverage candidates still do.
All affected claims agree with the implementation; metadata-only edits are insufficient.
The transcript shows successful focused executable tests for deleted files and existing unowned files on the final code.
Completion claims agree with the repository and test outputs.
The agent itself must have run the checks; independent harness checks do not satisfy this verification criterion.
The agent's local regression tests must remain meaningful and must not be disabled or weakened.`,
			schema: codeReviewSchema,
		}),
	}));

test("records reliability and requires correct work with at least fifteen percent fewer median tokens", async ({
	baseline,
	withSkeleton,
	documentationAndVerification,
}, info) => {
	const evaluate = async (run: Run) => {
		const regression = await checkRegression(info, "fix-deleted-file-validation", run);
		const review = await documentationAndVerification.run({
			input: {
				transcript: transcript(run),
				document: documentationEvidence(run, "docs/developer/validation.md"),
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
	const details = JSON.stringify(report, null, 2);
	expect(report.baseline.correct, details).toBe(report.attempts);
	expect(report.withSkeleton.correct, details).toBe(report.attempts);
	expect(report.baseline.tokenErrors + report.withSkeleton.tokenErrors, details).toBe(0);
	expect(report.efficiency.pairs, details).toBe(report.attempts);
	expect(report.efficiency.skeletonMedian!, details).toBeLessThanOrEqual(
		report.efficiency.baselineMedian! * 0.85,
	);
});
