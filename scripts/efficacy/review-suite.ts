import process from "node:process";
import type { Run } from "@post-print/agent-test";
import { describe, expect } from "@post-print/agent-test";
import { type Assessment, assessRun, measureReliability, type Pair } from "./measurements.ts";
import { receivedBundle } from "./review-analysis.ts";
import {
	decoyNotImportant,
	detectionInstructions,
	detectionSchema,
	judgeReport,
	summarizeDetection,
} from "./review-detection.ts";
import type { ReviewArm, ReviewScenario } from "./review-scenarios.ts";

const reviewPrompt = (firstCommand: string) =>
	`Review the feature branch against main. Start by running \`${firstCommand}\`. Report only; do not modify files.
Report each finding on its own line: <severity>\t<file>:<line>\t<bug class>\t<what breaks and why>. The severities are important, nit, and pre-existing.`;
const PROMPTS: Record<ReviewArm, string> = {
	control: reviewPrompt("git diff main...HEAD"),
	skeleton: reviewPrompt("npx --no-install skeleton review prepare --base main"),
};
const MIN_ASSESSED_FRACTION = 0.9;
const MIN_FLOOR_FRACTION = 0.8;
const MIN_BUNDLE_FRACTION = 0.8;

type ReviewJudge = {
	run(request: { input: { report: string } }): Promise<{
		output: Record<string, boolean> & { otherImportant: number; reason: string };
	}>;
};

function reviewEvaluator(scenario: ReviewScenario, detection: ReviewJudge, arm: ReviewArm) {
	return async (run: Run): Promise<Assessment> => {
		const { otherImportant, reason, ...found } = (
			await judgeReport(() => detection.run({ input: { report: run.output } }))
		).output as Record<string, boolean> & { otherImportant: number; reason: string };
		const unchanged = run.workspace.changedPaths.length === 0;
		const decoy: Record<string, boolean> = scenario.decoyPath
			? { decoyNotImportant: decoyNotImportant(run.output, scenario.decoyPath) }
			: {};
		return {
			checks: {
				...found,
				...decoy,
				unchanged,
				...(arm === "skeleton"
					? { receivedBundle: receivedBundle(run.toolCalls.map((call) => call.result)) }
					: {}),
			},
			reason: [
				unchanged ? "No files changed." : `Changed files: ${run.workspace.changedPaths.join(", ")}`,
				`Other important findings: ${otherImportant}.`,
				reason,
			].join("\n"),
		};
	};
}

/** These decide whether the round can be used, not who won. `review-report.ts` compares the sides. */
function expectUsableRound(scenario: ReviewScenario, pairs: Pair[], baselineArm: ReviewArm): void {
	const summary = summarizeDetection(pairs);
	for (const [side, arm] of [
		[summary.baseline, baselineArm],
		[summary.withSkeleton, "skeleton"],
	] as const) {
		if (arm === "skeleton")
			expect(
				side.hits.receivedBundle,
				"Skeleton reviewers receive the bundle",
			).toBeGreaterThanOrEqual(Math.ceil(side.evaluated * MIN_BUNDLE_FRACTION));
		expect(side.evaluated, "Enough runs were assessed").toBeGreaterThanOrEqual(
			Math.ceil(pairs.length * MIN_ASSESSED_FRACTION),
		);
		if (scenario.floor)
			expect(side.hits[scenario.floor], "Reviewers find the floor defect").toBeGreaterThanOrEqual(
				Math.ceil(side.evaluated * MIN_FLOOR_FRACTION),
			);
		expect(side.hits.unchanged, "No review changes files").toBe(side.evaluated);
	}
}

/** Null-check mode runs the Skeleton arm on both sides, so any difference is measurement noise. */
export function defineReviewSuite(scenario: ReviewScenario): void {
	const baselineArm: ReviewArm = process.env.SKELETON_REVIEW_NULL ? "skeleton" : "control";
	const workspace = (arm: ReviewArm) => `tests/fixtures/efficacy/${scenario.fixture}/${arm}`;
	const test = describe("Does Skeleton help?", ({ agent, judge }) => ({
		baseline: agent({ workspace: workspace(baselineArm) }).setup((work) =>
			scenario.seed(work, baselineArm),
		),
		withSkeleton: agent({ workspace: workspace("skeleton") }).setup((work) =>
			scenario.seed(work, "skeleton"),
		),
		detection: judge({
			prompt: detectionInstructions(scenario),
			schema: detectionSchema(scenario),
		}),
	}));

	test(`Skeleton review bundle on the ${scenario.name} change`, async ({
		baseline,
		withSkeleton,
		detection,
	}, info) => {
		const pairs: Pair[] = [];
		await measureReliability(info, async () => {
			const [without, withTool] = await Promise.allSettled([
				baseline.run({ prompt: PROMPTS[baselineArm] }),
				withSkeleton.run({ prompt: PROMPTS.skeleton }),
			]);
			const [baselineOutcome, skeletonOutcome] = await Promise.all([
				assessRun(without, reviewEvaluator(scenario, detection, baselineArm)),
				assessRun(withTool, reviewEvaluator(scenario, detection, "skeleton")),
			]);
			const pair = { baseline: baselineOutcome, withSkeleton: skeletonOutcome };
			pairs.push(pair);
			return pair;
		});
		await info.attach("defect-detection", {
			body: JSON.stringify(summarizeDetection(pairs), null, 2),
			contentType: "application/json",
		});
		expectUsableRound(scenario, pairs, baselineArm);
	});
}
