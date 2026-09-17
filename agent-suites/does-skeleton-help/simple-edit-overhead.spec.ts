import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Run } from "@post-print/agent-test";
import { describe, expect } from "@post-print/agent-test";
import { assessRun, measureReliability } from "../../scripts/efficacy/measurements.ts";

const test = describe("Does Skeleton help?", ({ agent }) => ({
	baseline: agent({ workspace: "tests/fixtures/efficacy/tradeoffs/trivial/control" }),
	withSkeleton: agent({ workspace: "tests/fixtures/efficacy/tradeoffs/trivial/skeleton" }),
}));

test("Skeleton overhead for a one-word edit", async ({ baseline, withSkeleton }, info) => {
	const prompt = 'Correct "delviery" to "delivery" in README.md. Make no other changes.';
	const evaluate = async (run: Run) => {
		const before = readFileSync(join(run.workspace.initial.path, "README.md"), "utf8");
		if (!existsSync(run.workspace.final.path)) throw new Error("Final snapshot is unavailable.");
		const afterPath = join(run.workspace.final.path, "README.md");
		const after = existsSync(afterPath) ? readFileSync(afterPath, "utf8") : null;
		return {
			checks: {
				exactEdit: after === before.replace("delviery", "delivery"),
				onlyReadme:
					run.workspace.changedPaths.length === 1 && run.workspace.changedPaths[0] === "README.md",
			},
			reason: "Compare the final file and changed paths directly.",
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
	// A negative savingsFraction exposes overhead; it is not a correctness failure.
});
