import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";
import { median } from "./median.ts";
import {
	defectComparison,
	type FixtureResult,
	featureVerdict,
	type Interval,
	leaveOneFixtureOut,
	type ReviewRunResult,
	recallDifference,
	reliabilityChecks,
	replicationCheck,
	splitHalfAgreement,
	tokenRatio,
} from "./review-analysis.ts";
import { textChecks } from "./review-detection.ts";
import { REVIEW_SCENARIOS, type ReviewScenario } from "./review-scenarios.ts";

type ExecutionEvent = {
	type: string;
	operationId: string;
	data: {
		name: string;
		type?: string;
		args?: unknown;
		output: unknown;
		input: { report: string };
		usage: { tokens: { total: number } };
	};
};
type LoadedRound = { fixture: FixtureResult; attempted: number; judged: number; agreeing: number };

function readEvents(execution: string): ExecutionEvent[] {
	return readFileSync(join(".agent-test/executions", execution, "events.ndjson"), "utf8")
		.split("\n")
		.filter(Boolean)
		.map((line) => JSON.parse(line));
}

/** The last verdict per report wins, because a retried judge records each attempt. */
function verdictsByReport(events: ExecutionEvent[]): Map<string, Record<string, boolean>> {
	const reports = new Map(
		events
			.filter((event) => event.type === "operation.evaluation-start")
			.map((event) => [event.operationId, event.data.input.report]),
	);
	const verdicts = new Map<string, Record<string, boolean>>();
	for (const event of events.filter((item) => item.type === "operation.evaluation")) {
		const report = reports.get(event.operationId);
		if (report !== undefined) verdicts.set(report, event.data.output as Record<string, boolean>);
	}
	return verdicts;
}

function stayedInBundle(events: ExecutionEvent[], operationId: string): boolean {
	const commands = events
		.filter(
			(event) =>
				event.operationId === operationId &&
				event.type === "operation.agent" &&
				event.data.type === "tool",
		)
		.map((event) => JSON.stringify(event.data.args));
	return (
		commands.some((command) => command.includes("skeleton review prepare")) &&
		!commands.some((command) => command.includes("skeleton context"))
	);
}

/** Rebuild every run and verdict from an event log, because passing runs keep no attachments. */
function loadExecution(execution: string, scenario: ReviewScenario): LoadedRound {
	const events = readEvents(execution);
	const verdicts = verdictsByReport(events);
	const completed = new Map(
		events
			.filter((event) => event.type === "operation.complete")
			.map((event) => [event.operationId, event]),
	);
	const defects = Object.keys(scenario.defects);
	const round: LoadedRound = {
		fixture: { fixture: scenario.name, defects, pairs: [] },
		attempted: 0,
		judged: 0,
		agreeing: 0,
	};
	const runResult = (operationId: string | undefined): ReviewRunResult | null => {
		const complete = operationId ? completed.get(operationId) : undefined;
		if (!(complete && operationId)) return null;
		const report = complete.data.output as string;
		const verdict = verdicts.get(report);
		const tokens = complete.data.usage.tokens.total;
		if (!(verdict && Number.isFinite(tokens) && tokens > 0)) return null;
		const direct = textChecks(scenario, report);
		round.judged += defects.length;
		round.agreeing += defects.filter((defect) => direct[defect] === verdict[defect]).length;
		return { found: verdict, tokens, usedBundle: stayedInBundle(events, operationId) };
	};
	const started = (side: string) =>
		events
			.filter((event) => event.type === "operation.start" && event.data.name === side)
			.map((event) => event.operationId);
	const baseline = started("baseline");
	const withSkeleton = started("withSkeleton");
	round.attempted = baseline.length;
	round.fixture.pairs = baseline.flatMap((operationId, index) => {
		const left = runResult(operationId);
		const right = runResult(withSkeleton[index]);
		return left && right ? [{ baseline: left, withSkeleton: right }] : [];
	});
	return round;
}

function instrumentEvidence(loaded: LoadedRound[], nullRound: FixtureResult | null) {
	const skeletonRuns = loaded.flatMap((round) =>
		round.fixture.pairs.map((pair) => pair.withSkeleton),
	);
	return {
		assessedFraction: Object.fromEntries(
			loaded.map((round) => [round.fixture.fixture, round.fixture.pairs.length / round.attempted]),
		),
		judgeTextAgreement:
			loaded.reduce((sum, round) => sum + round.agreeing, 0) /
			loaded.reduce((sum, round) => sum + round.judged, 0),
		bundleUse: skeletonRuns.filter((run) => run.usedBundle).length / skeletonRuns.length,
		nullRound,
	};
}

function fixtureSummary(fixture: FixtureResult) {
	return {
		fixture: fixture.fixture,
		pairs: fixture.pairs.length,
		recallDifference: recallDifference([fixture]),
		tokenRatio: tokenRatio([fixture]),
		medianTokens: {
			baseline: median(fixture.pairs.map((pair) => pair.baseline.tokens)),
			withSkeleton: median(fixture.pairs.map((pair) => pair.withSkeleton.tokens)),
		},
		defects: defectComparison(fixture),
	};
}

function buildReport(loaded: LoadedRound[], nullRound: FixtureResult | null) {
	const fixtures = loaded.map((round) => round.fixture);
	const evidence = instrumentEvidence(loaded, nullRound);
	return {
		fixtures: fixtures.map(fixtureSummary),
		recallDifference: recallDifference(fixtures),
		tokenRatio: tokenRatio(fixtures),
		splitHalfAgreement: splitHalfAgreement(fixtures),
		leaveOneOut: leaveOneFixtureOut(fixtures),
		nullDifference: nullRound ? recallDifference([nullRound]) : null,
		evidence: { ...evidence, nullRound: undefined },
		reliability: reliabilityChecks(fixtures, evidence),
		verdict: featureVerdict(fixtures),
	};
}

const percent = (value: number) => `${(value * 100).toFixed(1)}%`;
const ratio = (value: number) => value.toFixed(2);
const interval = (value: Interval, format: (value: number) => string) =>
	`${format(value.estimate)} (95% CI ${format(value.low)} to ${format(value.high)})`;

function printReport(report: ReturnType<typeof buildReport>): void {
	console.log(
		`Recall difference, Skeleton minus bare diff: ${interval(report.recallDifference, percent)}`,
	);
	console.log(`Token ratio, Skeleton over bare diff: ${interval(report.tokenRatio, ratio)}`);
	for (const fixture of report.fixtures) {
		console.log(
			`\n${fixture.fixture}: ${fixture.pairs} pairs, recall ${interval(fixture.recallDifference, percent)}, tokens ${fixture.medianTokens.withSkeleton} vs ${fixture.medianTokens.baseline}`,
		);
		for (const defect of fixture.defects)
			console.log(
				`  ${defect.defect}: Skeleton ${defect.skeleton}, bare diff ${defect.baseline}, p=${defect.p.toFixed(4)}`,
			);
	}
	console.log(`\nInstrument: ${JSON.stringify(report.evidence)}`);
	console.log(
		`Null round: ${report.nullDifference ? interval(report.nullDifference, percent) : "not run"}`,
	);
	console.log(`Split-half agreement: ${percent(report.splitHalfAgreement)}`);
	console.log(
		`Leave one fixture out: ${report.leaveOneOut.map((item) => `${item.without} ${percent(item.difference.estimate)}`).join(", ")}`,
	);
	console.log(`Reliability: ${JSON.stringify(report.reliability)}`);
	console.log(`Verdict: ${report.verdict}`);
}

function main(): void {
	const rounds = process.argv.slice(2).map((argument) => argument.split("="));
	const loadRounds = (prefix: string) =>
		rounds
			.filter(
				([name]) => name !== "null" && (name?.startsWith("again-") ?? false) === (prefix !== ""),
			)
			.map(([name, execution]) => {
				const key = name?.slice(prefix.length) as keyof typeof REVIEW_SCENARIOS;
				const scenario = REVIEW_SCENARIOS[key];
				if (!(scenario && execution))
					throw new Error(
						"Use <payments|notifications|real>=<execution>, null=<execution>, and again-<fixture>=<execution>.",
					);
				return loadExecution(execution, scenario);
			});
	const loaded = loadRounds("");
	const repeated = loadRounds("again-");
	const nullExecution = rounds.find(([name]) => name === "null")?.[1];
	const nullRound = nullExecution
		? loadExecution(nullExecution, REVIEW_SCENARIOS.payments).fixture
		: null;
	const report = buildReport(loaded, nullRound);
	mkdirSync("test-results", { recursive: true });
	writeFileSync("test-results/review-reliability.json", `${JSON.stringify(report, null, "\t")}\n`);
	printReport(report);
	if (repeated.length > 0) {
		const replication = replicationCheck(
			loaded.map((round) => round.fixture),
			repeated.map((round) => round.fixture),
		);
		console.log(`\nReplication: ${JSON.stringify(replication)}`);
		printReport(buildReport(repeated, nullRound));
	}
}

main();
