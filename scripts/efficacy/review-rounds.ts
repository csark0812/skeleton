import { readFileSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";
import { median } from "./median.ts";
import { decoyNotImportant, REVIEW_CHECKS } from "./review-detection.ts";

type ReviewRun = { name: string; output: string; usage: { tokens: { total: number } } };
type Verdict = Record<string, boolean | number | string>;
type ExecutionEvent = {
	type: string;
	operationId: string;
	data: ReviewRun & { input: { report: string }; output: string & Verdict };
};

function readExecutionEvents(id: string): ExecutionEvent[] {
	return readFileSync(join(".agent-test/executions", id, "events.ndjson"), "utf8")
		.split("\n")
		.filter(Boolean)
		.map((line) => JSON.parse(line));
}

/**
 * Print per-check hits for seeded-defect review executions. Passing runs do not keep their test
 * attachments on disk, so this rebuilds the counts from each execution's event log.
 */
function summarizeExecution(id: string): void {
	const events = readExecutionEvents(id);
	const reports = new Map(
		events
			.filter((event) => event.type === "operation.evaluation-start")
			.map((event) => [event.operationId, event.data.input.report]),
	);
	const verdicts = new Map<string | undefined, Verdict>(
		events
			.filter((event) => event.type === "operation.evaluation")
			.map((event) => [reports.get(event.operationId), event.data.output]),
	);
	for (const side of ["baseline", "withSkeleton"]) {
		const runs = events
			.filter((event) => event.type === "operation.complete" && event.data.name === side)
			.map((event) => event.data);
		const hits = Object.fromEntries(
			REVIEW_CHECKS.map((check) => [
				check,
				runs.filter((run) =>
					check === "decoyNotImportant"
						? decoyNotImportant(run.output)
						: verdicts.get(run.output)?.[check] === true,
				).length,
			]),
		);
		const tokens = median(runs.map((run) => run.usage.tokens.total));
		const judged = runs.filter((run) => verdicts.has(run.output)).length;
		console.log(
			id,
			side,
			`runs=${runs.length}`,
			`judged=${judged}`,
			`medianTokens=${tokens}`,
			JSON.stringify(hits),
		);
	}
}

for (const id of process.argv.slice(2)) summarizeExecution(id);
