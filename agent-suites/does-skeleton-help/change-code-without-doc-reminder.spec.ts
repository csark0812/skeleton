import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Run } from "@post-print/agent-test";
import { describe, expect } from "@post-print/agent-test";
import { checkBillingDocument } from "../../scripts/efficacy/billing-document.ts";
import { assessRun, measureReliability } from "../../scripts/efficacy/measurements.ts";
import { checkRegression } from "../../scripts/efficacy/regression.ts";
import { stageBillingChange } from "../../scripts/efficacy/workspace.ts";

const prompt = "Add one retry after a failed billing webhook delivery and verify the change.";
const test = describe("Does Skeleton help?", ({ agent }) => ({
	baseline: agent({ workspace: "tests/fixtures/efficacy/drift/control" }).setup(stageBillingChange),
	withSkeleton: agent({ workspace: "tests/fixtures/efficacy/drift/skeleton" }).setup(
		stageBillingChange,
	),
}));

test("Skeleton reliability and token efficiency when preserving staged billing work", async ({
	baseline,
	withSkeleton,
}, info) => {
	const evaluate = async (run: Run) => {
		const regression = await checkRegression(info, "change-code-without-doc-reminder", run);
		const documentPath = join(run.workspace.final.path, "docs/billing-webhooks.md");
		const document = existsSync(documentPath) ? readFileSync(documentPath, "utf8") : "";
		return {
			checks: {
				regression: regression.passed,
				...checkBillingDocument(document),
			},
			reason: regression.passed
				? "Regression checks passed; final documentation was checked directly."
				: regression.output,
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

	expect(report.withSkeleton.correct, "Every Skeleton repetition is correct").toBe(report.attempts);
	expect(
		report.baseline.executionErrors + report.withSkeleton.executionErrors,
		"No execution errors",
	).toBe(0);
	expect(
		report.baseline.evaluationErrors + report.withSkeleton.evaluationErrors,
		"No evaluation errors",
	).toBe(0);
	expect(
		report.baseline.tokenErrors + report.withSkeleton.tokenErrors,
		"No token measurements are invalid",
	).toBe(0);
	expect(
		report.efficiency.pairs,
		"Most repetitions form measurable efficiency pairs",
	).toBeGreaterThanOrEqual(Math.ceil(report.attempts * 0.6));
	expect(report.efficiency.skeletonMedian!, "Skeleton uses fewer median tokens").toBeLessThan(
		report.efficiency.baselineMedian!,
	);
});
