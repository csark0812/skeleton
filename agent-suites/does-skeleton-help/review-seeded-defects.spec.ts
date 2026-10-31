import type { Run } from "@post-print/agent-test";
import { describe, expect } from "@post-print/agent-test";
import { assessRun, measureReliability, type Pair } from "../../scripts/efficacy/measurements.ts";
import {
	reviewDetectionInstructions,
	reviewDetectionSchema,
	summarizeDetection,
} from "../../scripts/efficacy/review-detection.ts";
import { seedReviewChange } from "../../scripts/efficacy/workspace.ts";

const reviewPrompt = (firstCommand: string) =>
	`Review the feature branch against main. Start by running \`${firstCommand}\`. Report only; do not modify files.
Report each finding on its own line: <severity>\t<file>:<line>\t<bug class>\t<what breaks and why>. The severities are important, nit, and pre-existing.`;
const baselinePrompt = reviewPrompt("git diff main...HEAD");
const skeletonPrompt = reviewPrompt("npx --no-install skeleton review prepare --base main");

const test = describe("Does Skeleton help?", ({ agent, judge }) => ({
	baseline: agent({ workspace: "tests/fixtures/efficacy/review-change/control" }).setup(
		seedReviewChange,
	),
	withSkeleton: agent({ workspace: "tests/fixtures/efficacy/review-change/skeleton" }).setup(
		seedReviewChange,
	),
	detection: judge({ prompt: reviewDetectionInstructions, schema: reviewDetectionSchema }),
}));

test("Skeleton review bundle when a change contains seeded defects", async ({
	baseline,
	withSkeleton,
	detection,
}, info) => {
	const evaluate = async (run: Run) => {
		const { otherImportant, reason, ...found } = (
			await detection.run({ input: { report: run.output } })
		).output;
		const unchanged = run.workspace.changedPaths.length === 0;
		return {
			checks: { ...found, unchanged },
			reason: [
				unchanged ? "No files changed." : `Changed files: ${run.workspace.changedPaths.join(", ")}`,
				`Other important findings: ${otherImportant}.`,
				reason,
			].join("\n"),
		};
	};
	const pairs: Pair[] = [];
	const report = await measureReliability(info, async () => {
		const [without, withTool] = await Promise.allSettled([
			baseline.run({ prompt: baselinePrompt }),
			withSkeleton.run({ prompt: skeletonPrompt }),
		]);
		const [baselineOutcome, skeletonOutcome] = await Promise.all([
			assessRun(without, evaluate),
			assessRun(withTool, evaluate),
		]);
		const pair = { baseline: baselineOutcome, withSkeleton: skeletonOutcome };
		pairs.push(pair);
		return pair;
	});
	const summary = summarizeDetection(pairs);
	await info.attach("defect-detection", {
		body: JSON.stringify(summary, null, 2),
		contentType: "application/json",
	});

	// Record every outcome first. Detection is a reported number, not a pass bar, except this floor.
	for (const side of [report.baseline, report.withSkeleton]) {
		expect(side.executionErrors, "No run failed to execute").toBe(0);
		expect(side.evaluationErrors, "No report failed evaluation").toBe(0);
		expect(side.tokenErrors, "No token measurement is invalid").toBe(0);
	}
	expect(summary.baseline.hits.generic, "The baseline finds the floor defect in every run").toBe(
		report.attempts,
	);
	expect(summary.withSkeleton.hits.generic, "Skeleton finds the floor defect in every run").toBe(
		report.attempts,
	);
	for (const pair of pairs)
		expect(pair.withSkeleton.checks?.unchanged, "Skeleton review changes no files").toBe(true);
});
