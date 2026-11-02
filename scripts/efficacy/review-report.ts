import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";
import { median } from "./median.ts";
import {
	behaviorMix,
	bundleUseByFixture,
	defectComparison,
	directionalStability,
	type FixtureResult,
	featureVerdict,
	type Interval,
	keptContractFormat,
	leaveOneFixtureOut,
	type ReviewRunResult,
	recallDifference,
	receivedBundle,
	reliabilityChecks,
	replicationCheck,
	type SessionResult,
	sensitivity,
	sessionReport,
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
		prompt?: string;
		trace: { toolCalls: { args: unknown; result?: unknown }[] };
		type?: string;
		args?: unknown;
		output: unknown;
		input: { report: string };
		usage: { tokens: { total: number } };
	};
};
type ToolCalls = ExecutionEvent["data"]["trace"]["toolCalls"];
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

/** The bundle arrives as the prompt, or, in older sessions, as the result of a command the reviewer ran. */
function stayedInBundle(prompt: string, toolCalls: ToolCalls): boolean {
	return (
		receivedBundle([prompt, ...toolCalls.map((call) => call.result)]) &&
		!toolCalls.some((call) => JSON.stringify(call.args).includes("skeleton context"))
	);
}

function runBehavior(prompt: string, report: string, toolCalls: ToolCalls) {
	return {
		usedBundle: stayedInBundle(prompt, toolCalls),
		keptFormat: keptContractFormat(report),
		toolCalls: toolCalls.length,
	};
}

function eventsByOperation(events: ExecutionEvent[], type: string): Map<string, ExecutionEvent> {
	return new Map(
		events.filter((event) => event.type === type).map((event) => [event.operationId, event]),
	);
}

/** Rebuild every run and verdict from an event log, because passing runs keep no attachments. */
function loadExecution(execution: string, scenario: ReviewScenario): LoadedRound {
	const events = readEvents(execution);
	const verdicts = verdictsByReport(events);
	const completed = eventsByOperation(events, "operation.complete");
	const prompts = eventsByOperation(events, "operation.start");
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
		return {
			found: verdict,
			tokens,
			...runBehavior(
				prompts.get(operationId)?.data.prompt ?? "",
				report,
				complete.data.trace.toolCalls,
			),
		};
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
	return {
		assessedFraction: Object.fromEntries(
			loaded.map((round) => [round.fixture.fixture, round.fixture.pairs.length / round.attempted]),
		),
		judgeTextAgreement:
			loaded.reduce((sum, round) => sum + round.agreeing, 0) /
			loaded.reduce((sum, round) => sum + round.judged, 0),
		bundleUse: bundleUseByFixture(loaded.map((round) => round.fixture)),
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
		directionalStability: directionalStability(fixtures),
		sensitivity: sensitivity(fixtures),
		leaveOneOut: leaveOneFixtureOut(fixtures),
		nullDifference: nullRound ? recallDifference([nullRound]) : null,
		evidence: { ...evidence, nullRound: undefined },
		behavior: behaviorMix(fixtures),
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
	console.log(`Skeleton behavior: ${JSON.stringify(report.behavior)}`);
	console.log(
		`Null round: ${report.nullDifference ? interval(report.nullDifference, percent) : "not run"}`,
	);
	console.log(`Pooled split-half agreement, reported only: ${percent(report.splitHalfAgreement)}`);
	console.log(
		`Stability where a direction is claimed: ${JSON.stringify(report.directionalStability)}`,
	);
	console.log(`Sensitivity to a 10-point effect: ${percent(report.sensitivity)}`);
	console.log(
		`Leave one fixture out: ${report.leaveOneOut.map((item) => `${item.without} ${percent(item.difference.estimate)}`).join(", ")}`,
	);
	console.log(`Reliability: ${JSON.stringify(report.reliability)}`);
	console.log(`Verdict: ${report.verdict}`);
}

function combineRounds(first: LoadedRound, second: LoadedRound): LoadedRound {
	return {
		fixture: { ...first.fixture, pairs: [...first.fixture.pairs, ...second.fixture.pairs] },
		attempted: first.attempted + second.attempted,
		judged: first.judged + second.judged,
		agreeing: first.agreeing + second.agreeing,
	};
}

type SessionManifest = {
	confirmatory: boolean;
	/** A study runs only the rounds it needs and is scored on its own, with `--study`. */
	study?: string;
	day: string;
	payments: string;
	notifications: string;
	real: string;
	null: string;
}[];
const FIXTURE_ROUNDS = ["payments", "notifications", "real"] as const;

function loadSession(entry: SessionManifest[number]): SessionResult {
	return {
		day: entry.day,
		fixtures: [
			loadExecution(entry.payments, REVIEW_SCENARIOS.payments).fixture,
			loadExecution(entry.notifications, REVIEW_SCENARIOS.notifications).fixture,
			loadExecution(entry.real, REVIEW_SCENARIOS.real).fixture,
		],
		nullRound: loadExecution(entry.null, REVIEW_SCENARIOS.payments).fixture,
	};
}

function printSessions(path: string): void {
	const manifest: SessionManifest = JSON.parse(readFileSync(path, "utf8"));
	for (const confirmatory of [false, true]) {
		const entries = manifest.filter(
			(entry) => entry.confirmatory === confirmatory && entry.study === undefined,
		);
		if (entries.length < 2) continue;
		console.log(confirmatory ? "\nConfirmatory sessions:" : "\nExploratory sessions:");
		console.log(JSON.stringify(sessionReport(entries.map(loadSession)), null, "\t"));
	}
}

/** Per fixture a study ran: each session's recall difference, then every pair pooled, by defect. */
function printStudy(study: string, path: string): void {
	const manifest: SessionManifest = JSON.parse(readFileSync(path, "utf8"));
	const entries = manifest.filter((entry) => entry.study === study);
	if (entries.length === 0) throw new Error(`No sessions recorded for study ${study}.`);
	for (const name of [...FIXTURE_ROUNDS, "null"] as const) {
		const executions = entries.flatMap((entry) => (entry[name] ? [entry[name]] : []));
		if (executions.length === 0) continue;
		const scenario = REVIEW_SCENARIOS[name === "null" ? "payments" : name];
		const rounds = executions.map((execution) => loadExecution(execution, scenario).fixture);
		const pooled = { ...rounds[0], pairs: rounds.flatMap((round) => round.pairs) } as FixtureResult;
		console.log(
			`\n${name}: ${rounds.length} sessions, ${pooled.pairs.length} pairs, recall ${interval(recallDifference([pooled]), percent)}, tokens ${interval(tokenRatio([pooled]), ratio)}`,
		);
		console.log(
			`  per session: ${rounds.map((round) => percent(recallDifference([round]).estimate)).join(", ")}`,
		);
		for (const defect of defectComparison(pooled))
			console.log(
				`  ${defect.defect}: Skeleton ${defect.skeleton}, bare diff ${defect.baseline}, p=${defect.p.toFixed(4)}`,
			);
	}
}

function compareRounds(): void {
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
		console.log("\nBoth runs combined:");
		printReport(
			buildReport(
				loaded.map((round, index) => combineRounds(round, repeated[index] as LoadedRound)),
				nullRound,
			),
		);
	}
}

function main(): void {
	const manifest = "agent-suites/seeds/review-sessions.json";
	if (process.argv[2] === "--sessions") printSessions(process.argv[3] ?? manifest);
	else if (process.argv[2] === "--study") printStudy(process.argv[3] ?? "", manifest);
	else compareRounds();
}

main();
