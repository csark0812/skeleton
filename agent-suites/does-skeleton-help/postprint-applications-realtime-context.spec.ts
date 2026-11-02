import type { Run } from "@post-print/agent-test";
import { describe, expect } from "@post-print/agent-test";
import { reviewInstructions, reviewSchema, transcript } from "../../scripts/efficacy/judge.ts";
import { assessRun, measureReliability } from "../../scripts/efficacy/measurements.ts";

const prompt =
	"I'm about to change Workspace document realtime events. Tell me the contract boundaries I need to keep in sync and how to regenerate the client.";
const test = describe("Does Skeleton help?", ({ agent, judge }) => ({
	baseline: agent({ workspace: "tests/fixtures/efficacy/postprint-applications/control" }),
	withSkeleton: agent({
		workspace: "tests/fixtures/efficacy/postprint-applications/package-head",
	}),
	answer: judge({
		prompt: `${reviewInstructions}
The run must meet these requirements:
The answer identifies apps/backend/postprint/realtime/schemas.py as the backend schema owner.
It identifies apps/backend/postprint/papers/realtime/publish.py and says publication happens after transaction commit.
It identifies tspackages/websocket/src/realtime/realtime.gen.ts as generated and says to run bun run generate-clients rather than hand-editing it.
It identifies apps/client/src/websocket/projectUpdates.ts as the workspace.document_updated client handler.
It says that handler invalidates project document list, document detail, document content, and workspace folder queries.
Every required fact agrees with the repository, and the answer does not contradict the repository.`,
		schema: reviewSchema,
	}),
}));

test("Skeleton token efficiency in a PostPrint-shaped applications monorepo", async ({
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

	expect(report.baseline.correct, "Every baseline repetition is correct").toBe(report.attempts);
	expect(report.withSkeleton.correct, "Every Skeleton repetition is correct").toBe(report.attempts);
	expect(
		report.baseline.tokenErrors + report.withSkeleton.tokenErrors,
		"No token measurements are invalid",
	).toBe(0);
	expect(report.efficiency.pairs, "Every repetition forms a measurable efficiency pair").toBe(
		report.attempts,
	);
	const savingsRatio = report.attempts === 1 ? 1 : 0.65;
	expect(
		report.efficiency.skeletonMedian!,
		report.attempts === 1
			? "Skeleton uses fewer median tokens in the diagnostic pair"
			: "Skeleton uses at least 35% fewer median tokens",
	).toBeLessThan(report.efficiency.baselineMedian! * savingsRatio);
});
