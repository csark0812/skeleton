import { readFileSync } from "node:fs";
import process from "node:process";
import type { Run } from "@post-print/agent-test";
import { median } from "./median.ts";

export type TestAttachments = {
	attach(name: string, options: { body: string | Buffer; contentType: string }): Promise<void>;
};
type MeasuredRun = Pick<Run, "id" | "usage" | "durationMs">;
export type Assessment = { checks: Record<string, boolean>; reason: string };
export type Outcome = {
	status: "correct" | "incorrect" | "execution-error" | "evaluation-error";
	reason: string;
	checks?: Record<string, boolean>;
	runId?: string;
	tokens?: number;
	tokenError?: string;
	durationMs?: number;
};
export type Pair = { baseline: Outcome; withSkeleton: Outcome };

/** Keep execution failures and evaluation failures separate from incorrect work. */
export async function assessRun<T extends MeasuredRun>(
	execution: PromiseSettledResult<T>,
	evaluate: (run: T) => Promise<Assessment>,
): Promise<Outcome> {
	if (execution.status === "rejected")
		return { status: "execution-error", reason: errorMessage(execution.reason) };
	const run = execution.value;
	const total = run.usage.tokens.total;
	const measured = {
		runId: run.id,
		durationMs: run.durationMs,
		...(total !== undefined && Number.isFinite(total) && total > 0
			? { tokens: total }
			: { tokenError: "Agent usage must report a finite, positive token count." }),
	};
	try {
		const assessment = await evaluate(run);
		if (Object.keys(assessment.checks).length === 0)
			throw new Error("No correctness checks were supplied.");
		return {
			...measured,
			...assessment,
			status: Object.values(assessment.checks).every(Boolean) ? "correct" : "incorrect",
		};
	} catch (error) {
		return { ...measured, status: "evaluation-error", reason: errorMessage(error) };
	}
}

/** Record every repetition before the test applies its acceptance assertions. */
export async function measureReliability(
	info: TestAttachments,
	runPair: () => Promise<Pair>,
	repetitions = Number(process.env.SKELETON_EFFICACY_RUNS ?? 5),
) {
	if (!Number.isInteger(repetitions) || repetitions < 1)
		throw new Error("SKELETON_EFFICACY_RUNS must be a positive integer.");
	await info.attach("package-provenance", {
		body: readFileSync(
			new URL("../../tests/fixtures/efficacy/package-artifact.json", import.meta.url),
		),
		contentType: "application/json",
	});
	const pairs: Pair[] = [];
	for (let index = 0; index < repetitions; index++) {
		const pair = await runPair();
		pairs.push(pair);
		await info.attach(`pair-${index + 1}`, {
			body: JSON.stringify(pair),
			contentType: "application/json",
		});
	}
	const report = summarizeReliability(pairs);
	await info.attach("reliability-report", {
		body: JSON.stringify(report, null, 2),
		contentType: "application/json",
	});
	return report;
}

export function summarizeReliability(pairs: Pair[]) {
	const paired = {
		bothCorrect: 0,
		onlyBaselineCorrect: 0,
		onlySkeletonCorrect: 0,
		neitherCorrect: 0,
		unassessed: 0,
	};
	for (const pair of pairs) paired[pairOutcome(pair)]++;
	return {
		attempts: pairs.length,
		baseline: summarizeOutcomes(pairs.map((pair) => pair.baseline)),
		withSkeleton: summarizeOutcomes(pairs.map((pair) => pair.withSkeleton)),
		paired,
		efficiency: summarizeEfficiency(pairs),
	};
}

function pairOutcome(pair: Pair) {
	const left = pair.baseline.status;
	const right = pair.withSkeleton.status;
	if (left.endsWith("error") || right.endsWith("error")) return "unassessed";
	if (left === "correct" && right === "correct") return "bothCorrect";
	if (left === "correct") return "onlyBaselineCorrect";
	if (right === "correct") return "onlySkeletonCorrect";
	return "neitherCorrect";
}

function summarizeEfficiency(pairs: Pair[]) {
	const tokens = { baseline: [] as number[], withSkeleton: [] as number[] };
	for (const pair of pairs) {
		if (
			pairOutcome(pair) === "bothCorrect" &&
			pair.baseline.tokens !== undefined &&
			pair.withSkeleton.tokens !== undefined
		) {
			tokens.baseline.push(pair.baseline.tokens);
			tokens.withSkeleton.push(pair.withSkeleton.tokens);
		}
	}
	const baselineMedian = tokens.baseline.length ? median(tokens.baseline) : null;
	const skeletonMedian = tokens.withSkeleton.length ? median(tokens.withSkeleton) : null;
	return {
		scope: "Pairs where both runs are correct and both token totals are valid",
		pairs: tokens.baseline.length,
		tokens,
		baselineMedian,
		skeletonMedian,
		savingsFraction:
			baselineMedian !== null && skeletonMedian !== null
				? 1 - skeletonMedian / baselineMedian
				: null,
	};
}

function summarizeOutcomes(outcomes: Outcome[]) {
	const correct = outcomes.filter((outcome) => outcome.status === "correct").length;
	const incorrect = outcomes.filter((outcome) => outcome.status === "incorrect").length;
	const evaluated = correct + incorrect;
	return {
		attempted: outcomes.length,
		evaluated,
		correct,
		incorrect,
		executionErrors: outcomes.filter((outcome) => outcome.status === "execution-error").length,
		evaluationErrors: outcomes.filter((outcome) => outcome.status === "evaluation-error").length,
		tokenErrors: outcomes.filter((outcome) => outcome.tokenError !== undefined).length,
		successfulAttemptRate: outcomes.length ? correct / outcomes.length : null,
		evaluatedSuccessRate: evaluated ? correct / evaluated : null,
		evaluatedSuccessWilson95: wilsonInterval(correct, evaluated),
	};
}

/** Descriptive binomial uncertainty for this task and host, not cross-repository reliability. */
function wilsonInterval(successes: number, count: number) {
	if (!count) return null;
	const z = 1.959963984540054;
	const proportion = successes / count;
	const denominator = 1 + (z * z) / count;
	const center = (proportion + (z * z) / (2 * count)) / denominator;
	const margin =
		(z * Math.sqrt((proportion * (1 - proportion)) / count + (z * z) / (4 * count * count))) /
		denominator;
	return { lower: Math.max(0, center - margin), upper: Math.min(1, center + margin) };
}

function errorMessage(error: unknown) {
	return error instanceof Error ? error.message : String(error);
}
