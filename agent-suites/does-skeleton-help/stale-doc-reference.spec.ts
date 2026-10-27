import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Run } from "@post-print/agent-test";
import { describe, expect } from "@post-print/agent-test";
import { checkInvoiceReminderDocument } from "../../scripts/efficacy/invoice-document.ts";
import { assessRun, measureReliability } from "../../scripts/efficacy/measurements.ts";
import { checkRegression } from "../../scripts/efficacy/regression.ts";
import { installSkeletonPreCommitHook } from "../../scripts/efficacy/workspace.ts";

const DOCUMENT = "docs/invoice-reminders.md";
const test = describe("Does Skeleton help?", ({ agent }) => ({
	baseline: agent({ workspace: "tests/fixtures/efficacy/doc-reference/control" }),
	withSkeleton: agent({ workspace: "tests/fixtures/efficacy/doc-reference/skeleton" }).setup(
		installSkeletonPreCommitHook,
	),
}));

function finalText(run: Run, path: string): string {
	const absolute = join(run.workspace.final.path, path);
	return existsSync(absolute) ? readFileSync(absolute, "utf8") : "";
}

test("Skeleton reliability when a rename breaks a linked document", async ({
	baseline,
	withSkeleton,
}, info) => {
	const prompt =
		"Rename sendInvoiceReminder to remindInvoiceRecipient, run the tests, and commit the change.";
	const evaluate = async (run: Run) => {
		const regression = await checkRegression(info, "stale-doc-reference", run);
		return {
			checks: {
				regression: regression.passed,
				...checkInvoiceReminderDocument(finalText(run, DOCUMENT)),
			},
			reason: regression.passed
				? "Regression checks passed; the final document was checked directly."
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

	// The benefit is a document that stays correct; baseline correctness is measured, not required.
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
});

test("Skeleton overhead when an edit leaves a narrowed dependency untouched", async ({
	baseline,
	withSkeleton,
}, info) => {
	const prompt =
		"Pad invoice numbers to six digits instead of five, update the tests, and commit the change.";
	const evaluate = async (run: Run) => {
		const regression = await checkRegression(info, "stale-doc-reference-friction", run);
		const before = readFileSync(join(run.workspace.initial.path, DOCUMENT), "utf8");
		return {
			checks: {
				regression: regression.passed,
				documentUnchanged: finalText(run, DOCUMENT) === before,
				onlyCodeAndTests: run.workspace.changedPaths.every((path) =>
					["src/invoices.ts", "tests/invoices.test.ts"].includes(path),
				),
			},
			reason: regression.passed
				? `Regression checks passed; changed paths: ${run.workspace.changedPaths.join(", ")}`
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

	expect(report.baseline.correct, "Every baseline repetition is correct").toBe(report.attempts);
	expect(report.withSkeleton.correct, "Every Skeleton repetition is correct").toBe(report.attempts);
	expect(report.efficiency.pairs, "Every repetition forms a measurable efficiency pair").toBe(
		report.attempts,
	);
	// A negative savingsFraction exposes hook overhead; it is not a correctness failure.
});
