import { AgentInfrastructureError } from "@post-print/agent-harness";
import type { Run } from "@post-print/agent-test";
import { type Assessment, assessRun, type Outcome } from "./measurements.ts";

export type RetriedExecution<T> =
	| { status: "fulfilled"; value: T; original?: unknown }
	| { status: "rejected"; reason: unknown; original?: unknown };

/** Retry only an SDK-classified infrastructure failure, preserving its first error. */
export async function runWithInfrastructureRetry<T>(
	operation: () => Promise<T>,
): Promise<RetriedExecution<T>> {
	try {
		return { status: "fulfilled", value: await operation() };
	} catch (original) {
		if (!(original instanceof AgentInfrastructureError))
			return { status: "rejected", reason: original };
		try {
			return { status: "fulfilled", value: await operation(), original };
		} catch (reason) {
			return { status: "rejected", reason, original };
		}
	}
}

export function shouldRetryEvaluation(infrastructureFailure: boolean) {
	return infrastructureFailure;
}

/** An attempt gets one automatic retry total, whether execution or evaluation failed. */
export async function assessWithEvaluationRetry(
	execution: RetriedExecution<Run>,
	evaluate: (run: Run) => Promise<Assessment>,
): Promise<Outcome> {
	const first = await assessRun(execution, evaluate);
	if (execution.original !== undefined)
		first.retry = {
			kind: "execution",
			originalError: errorMessage(execution.original),
		};
	if (
		execution.original !== undefined ||
		first.status !== "evaluation-error" ||
		!shouldRetryEvaluation(first.evaluationInfrastructureError === true) ||
		execution.status !== "fulfilled"
	)
		return first;
	const retried = await assessRun(execution, evaluate);
	retried.retry = { kind: "evaluation", originalError: first.reason };
	return retried;
}

function errorMessage(error: unknown) {
	return error instanceof Error ? error.message : String(error);
}
