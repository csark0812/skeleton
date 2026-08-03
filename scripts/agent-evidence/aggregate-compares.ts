#!/usr/bin/env bun
/**
 * Aggregate agent-suites/evidence/runs/<id>/compare-report.json into SUMMARY.json + SUMMARY.md.
 *
 * Usage:
 *   bun scripts/agent-evidence/aggregate-compares.ts
 *   bun scripts/agent-evidence/aggregate-compares.ts --runs-dir agent-suites/evidence/runs
 */

import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import process from "node:process";

interface ScenarioMetrics {
	passed: boolean;
	skipped?: boolean;
	durationMs: number;
	toolCallCount: number;
	skillCount: number;
	registryHopCount: number;
	totalTokens?: number;
	inputTokens?: number;
	outputTokens?: number;
}

interface ScenarioCompareDelta {
	scenario: string;
	a: ScenarioMetrics;
	b: ScenarioMetrics;
	deltas: {
		passedChanged: boolean;
		durationMs: number;
		toolCallCount: number;
		skillCount: number;
		registryHopCount: number;
		totalTokens?: number;
	};
}

interface SuiteCompareReport {
	aLabel: string;
	bLabel: string;
	aSuite: string;
	bSuite: string;
	paired: ScenarioCompareDelta[];
	summary: {
		pairedCount: number;
		passRegressions: number;
		passImprovements: number;
		meanDurationDeltaMs?: number;
		meanToolCallDelta?: number;
		meanTotalTokensDelta?: number;
	};
}

interface RunFile {
	id: string;
	path: string;
	report: SuiteCompareReport;
}

function median(values: number[]): number | undefined {
	if (values.length === 0) return;
	const sorted = [...values].sort((x, y) => x - y);
	const mid = Math.floor(sorted.length / 2);
	return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid];
}

function mean(values: number[]): number | undefined {
	if (values.length === 0) return;
	return values.reduce((s, v) => s + v, 0) / values.length;
}

/** Exact two-sided McNemar p-value with continuity correction via binomial mid-p approx. */
function mcnemarExact(b: number, c: number): { b: number; c: number; n: number; pValue: number } {
	const n = b + c;
	if (n === 0) {
		return { b, c, n, pValue: 1 };
	}
	// Exact binomial test of H0: p=0.5 on discordant pairs (two-sided).
	const k = Math.min(b, c);
	let cdf = 0;
	for (let i = 0; i <= k; i++) {
		cdf += binomialPmf(n, i);
	}
	const pValue = Math.min(1, 2 * cdf);
	return { b, c, n, pValue };
}

function binomialPmf(n: number, k: number): number {
	return comb(n, k) * 0.5 ** n;
}

function comb(n: number, k: number): number {
	if (k < 0 || k > n) return 0;
	k = Math.min(k, n - k);
	let num = 1;
	for (let i = 1; i <= k; i++) {
		num = (num * (n - k + i)) / i;
	}
	return num;
}

/** Bootstrap percentile CI for the mean of deltas. */
function bootstrapMeanCi(
	values: number[],
	reps = 2000,
	alpha = 0.05,
): { mean: number; lo: number; hi: number } | undefined {
	if (values.length === 0) return;
	const m = mean(values)!;
	if (values.length === 1) {
		return { mean: m, lo: m, hi: m };
	}
	const samples: number[] = [];
	for (let r = 0; r < reps; r++) {
		let sum = 0;
		for (let i = 0; i < values.length; i++) {
			sum += values[Math.floor(Math.random() * values.length)]!;
		}
		samples.push(sum / values.length);
	}
	samples.sort((a, b) => a - b);
	const lo = samples[Math.floor((alpha / 2) * samples.length)]!;
	const hi = samples[Math.min(samples.length - 1, Math.floor((1 - alpha / 2) * samples.length))]!;
	return { mean: m, lo, hi };
}

async function collectRuns(runsDir: string): Promise<RunFile[]> {
	const entries = await readdir(runsDir, { withFileTypes: true }).catch(() => []);
	const runs: RunFile[] = [];
	for (const ent of entries) {
		if (!ent.isDirectory()) continue;
		const path = join(runsDir, ent.name, "compare-report.json");
		try {
			const report = JSON.parse(await readFile(path, "utf8")) as SuiteCompareReport;
			if (!Array.isArray(report.paired)) continue;
			runs.push({ id: ent.name, path, report });
		} catch {
			// skip incomplete dirs
		}
	}
	runs.sort((a, b) => a.id.localeCompare(b.id));
	return runs;
}

function scenarioIds(runs: RunFile[]): string[] {
	const names = new Set<string>();
	for (const run of runs) {
		for (const row of run.report.paired) names.add(row.scenario);
	}
	return [...names].sort();
}

function fmt(n: number | undefined, digits = 1): string {
	if (n === undefined || Number.isNaN(n)) return "—";
	return Number.isInteger(n) ? String(n) : n.toFixed(digits);
}

function pct(n: number, d: number): string {
	if (d === 0) return "—";
	return `${((100 * n) / d).toFixed(0)}%`;
}

function parseCompareArgs(argv: string[]): { runsDir: string; outDir: string } {
	let runsDir = resolve("agent-suites/evidence/runs");
	let outDir = resolve("agent-suites/evidence");
	for (let i = 0; i < argv.length; i++) {
		if (argv[i] === "--runs-dir" && argv[i + 1]) runsDir = resolve(argv[++i]!);
		else if (argv[i] === "--out-dir" && argv[i + 1]) outDir = resolve(argv[++i]!);
	}
	return { runsDir, outDir };
}

type ScenarioStats = {
	n: number;
	cleanPass: number;
	messyPass: number;
	mcnemar: { b: number; c: number; n: number; pValue: number };
	tokenDeltas: number[];
	toolDeltas: number[];
	durationDeltas: number[];
};

type ScenarioStatsAccumulator = {
	n: number;
	cleanPass: number;
	messyPass: number;
	mcnemarB: number;
	mcnemarC: number;
	tokenDeltas: number[];
	toolDeltas: number[];
	durationDeltas: number[];
};

function accumulatePairedRow(stats: ScenarioStatsAccumulator, row: ScenarioCompareDelta): void {
	stats.n++;
	if (row.a.passed) stats.cleanPass++;
	if (row.b.passed) stats.messyPass++;
	if (row.a.passed && !row.b.passed) stats.mcnemarB++;
	if (!row.a.passed && row.b.passed) stats.mcnemarC++;
	if (typeof row.deltas.totalTokens === "number") stats.tokenDeltas.push(row.deltas.totalTokens);
	stats.toolDeltas.push(row.deltas.toolCallCount);
	stats.durationDeltas.push(row.deltas.durationMs);
}

function aggregateScenarioStats(name: string, runs: RunFile[]): ScenarioStats {
	const stats = {
		n: 0,
		cleanPass: 0,
		messyPass: 0,
		mcnemarB: 0,
		mcnemarC: 0,
		tokenDeltas: [] as number[],
		toolDeltas: [] as number[],
		durationDeltas: [] as number[],
	};
	for (const run of runs) {
		const row = run.report.paired.find((p) => p.scenario === name);
		if (!row || row.a.skipped || row.b.skipped) continue;
		accumulatePairedRow(stats, row);
	}
	return {
		n: stats.n,
		cleanPass: stats.cleanPass,
		messyPass: stats.messyPass,
		mcnemar: mcnemarExact(stats.mcnemarB, stats.mcnemarC),
		tokenDeltas: stats.tokenDeltas,
		toolDeltas: stats.toolDeltas,
		durationDeltas: stats.durationDeltas,
	};
}

interface EvaluateGatesInput {
	perScenario: Record<string, ScenarioStats>;
	groundingNames: string[];
	nRuns: number;
	protocolTargetN: number;
	groundingTokenDeltas: number[];
}

function evaluateGates(input: EvaluateGatesInput) {
	const { perScenario, groundingNames, nRuns, protocolTargetN, groundingTokenDeltas } = input;
	const preliminary = nRuns < protocolTargetN;
	const groundingGate = groundingNames.some((name) => {
		const m = perScenario[name]?.mcnemar;
		return m && m.n > 0 && m.pValue < 0.05 && m.b > m.c;
	});
	const tokenMed = median(groundingTokenDeltas);
	const tokenGate = tokenMed !== undefined && tokenMed > 0;
	return { preliminary, groundingGate, tokenGate };
}

function scenarioSummaryEntry(name: string, s: ScenarioStats) {
	return [
		name,
		{
			n: s.n,
			cleanPassRate: s.n ? s.cleanPass / s.n : 0,
			messyPassRate: s.n ? s.messyPass / s.n : 0,
			cleanPass: s.cleanPass,
			messyPass: s.messyPass,
			mcnemar: s.mcnemar,
			medianTokenDelta: median(s.tokenDeltas),
			meanTokenDelta: mean(s.tokenDeltas),
			tokenDeltaBootstrap95: bootstrapMeanCi(s.tokenDeltas),
			medianToolDelta: median(s.toolDeltas),
			meanToolDelta: mean(s.toolDeltas),
			medianDurationDeltaMs: median(s.durationDeltas),
		},
	] as const;
}

interface BuildSummaryInput {
	runs: RunFile[];
	scenarios: string[];
	perScenario: Record<string, ScenarioStats>;
	groundingTokenDeltas: number[];
	allTokenDeltas: number[];
	allToolDeltas: number[];
	gates: ReturnType<typeof evaluateGates>;
}

function buildSummaryObject(input: BuildSummaryInput) {
	const {
		runs,
		scenarios,
		perScenario,
		groundingTokenDeltas,
		allTokenDeltas,
		allToolDeltas,
		gates,
	} = input;
	const protocolTargetN = 10;
	return {
		generatedAt: new Date().toISOString(),
		protocolTargetN,
		nRuns: runs.length,
		preliminary: gates.preliminary,
		runIds: runs.map((r) => r.id),
		aLabel: runs[0]!.report.aLabel,
		bLabel: runs[0]!.report.bLabel,
		gates: {
			groundingMcnemarP05: gates.groundingGate,
			groundingTokenMedianMessyHigher: gates.tokenGate,
			readmeFinalClaimsAllowed: !gates.preliminary && gates.groundingGate && gates.tokenGate,
		},
		overall: {
			meanTokenDelta: mean(allTokenDeltas),
			medianTokenDelta: median(allTokenDeltas),
			tokenDeltaBootstrap95: bootstrapMeanCi(allTokenDeltas),
			meanToolDelta: mean(allToolDeltas),
			medianToolDelta: median(allToolDeltas),
			groundingMedianTokenDelta: median(groundingTokenDeltas),
			groundingTokenDeltaBootstrap95: bootstrapMeanCi(groundingTokenDeltas),
		},
		scenarios: Object.fromEntries(
			scenarios.map((name) => scenarioSummaryEntry(name, perScenario[name]!)),
		),
	};
}

function scenarioMarkdownRow(
	name: string,
	s: {
		cleanPass: number;
		messyPass: number;
		n: number;
		mcnemar: { b: number; c: number; pValue: number };
		medianTokenDelta?: number;
		medianToolDelta?: number;
	},
): string {
	return `| ${name} | ${s.cleanPass}/${s.n} (${pct(s.cleanPass, s.n)}) | ${s.messyPass}/${s.n} (${pct(s.messyPass, s.n)}) | ${s.mcnemar.b}/${s.mcnemar.c} | ${s.mcnemar.pValue.toFixed(4)} | ${fmt(s.medianTokenDelta, 0)} | ${fmt(s.medianToolDelta, 0)} |`;
}

function summaryMarkdownOverall(
	summary: ReturnType<typeof buildSummaryObject>,
	groundingTokenDeltas: number[],
): string[] {
	return [
		"",
		"## Overall deltas (messy − clean)",
		"",
		`| Metric | Median | Mean | Bootstrap 95% CI (mean) |`,
		`| ------ | ------ | ---- | ----------------------- |`,
		`| Total tokens (all scenarios) | ${fmt(summary.overall.medianTokenDelta, 0)} | ${fmt(summary.overall.meanTokenDelta, 0)} | ${summary.overall.tokenDeltaBootstrap95 ? `${fmt(summary.overall.tokenDeltaBootstrap95.lo, 0)} … ${fmt(summary.overall.tokenDeltaBootstrap95.hi, 0)}` : "—"} |`,
		`| Total tokens (grounding only) | ${fmt(summary.overall.groundingMedianTokenDelta, 0)} | ${fmt(mean(groundingTokenDeltas), 0)} | ${summary.overall.groundingTokenDeltaBootstrap95 ? `${fmt(summary.overall.groundingTokenDeltaBootstrap95.lo, 0)} … ${fmt(summary.overall.groundingTokenDeltaBootstrap95.hi, 0)}` : "—"} |`,
		`| Tool calls | ${fmt(summary.overall.medianToolDelta, 0)} | ${fmt(summary.overall.meanToolDelta, 1)} | — |`,
		"",
		"McNemar **b** = clean pass / messy fail; **c** = clean fail / messy pass. Positive token Δ means messy used more tokens.",
		"",
		"See [transcripts/](transcripts/) for curated clean vs messy excerpts.",
		"",
	];
}

interface BuildMarkdownInput {
	summary: ReturnType<typeof buildSummaryObject>;
	runs: RunFile[];
	scenarios: string[];
	groundingTokenDeltas: number[];
	gates: ReturnType<typeof evaluateGates>;
}

function buildSummaryMarkdown(input: BuildMarkdownInput): string {
	const { summary, runs, scenarios, groundingTokenDeltas, gates } = input;
	const protocolTargetN = summary.protocolTargetN;
	const lines: string[] = [
		"# Behavioral evidence summary",
		"",
		`**Source of truth for** aggregated Skeleton A/B live compares (\`skeleton-clean\` vs \`skeleton-messy\`).`,
		"",
		`<!-- doc-meta: owner=eng | last-reviewed=${new Date().toISOString().slice(0, 10)} -->`,
		"",
		gates.preliminary
			? `**Status: preliminary (N=${runs.length} / target ${protocolTargetN}).** Do not treat McNemar p-values as final README claims until N=${protocolTargetN}.`
			: `**Status: protocol complete (N=${runs.length}).**`,
		"",
		`Generated: ${summary.generatedAt}`,
		"",
		`Runs: ${runs.map((r) => `\`${r.id}\``).join(", ")}`,
		"",
		"## Gates",
		"",
		`| Gate | Result |`,
		`| ---- | ------ |`,
		`| Grounding McNemar p<0.05 (clean>messy) | ${gates.groundingGate ? "PASS" : "FAIL / n/a"} |`,
		`| Grounding median token Δ (messy−clean) > 0 | ${gates.tokenGate ? "PASS" : "FAIL / n/a"} |`,
		`| Final README claims allowed | ${summary.gates.readmeFinalClaimsAllowed ? "yes" : "no"} |`,
		"",
		"## Per-scenario",
		"",
		"| Scenario | Clean pass | Messy pass | McNemar (b/c) | p | Median Δ tokens | Median Δ tools |",
		"| -------- | ---------- | ---------- | ------------- | - | --------------- | -------------- |",
	];

	for (const name of scenarios) {
		lines.push(scenarioMarkdownRow(name, summary.scenarios[name]!));
	}

	lines.push(...summaryMarkdownOverall(summary, groundingTokenDeltas));
	return `${lines.join("\n")}\n`;
}

function buildAggregateContext(runs: RunFile[]) {
	const scenarios = scenarioIds(runs);
	const perScenario = Object.fromEntries(
		scenarios.map((name) => [name, aggregateScenarioStats(name, runs)]),
	) as Record<string, ScenarioStats>;
	const groundingNames = scenarios.filter((s) => s.startsWith("grounding:"));
	const groundingTokenDeltas = groundingNames.flatMap(
		(name) => perScenario[name]?.tokenDeltas ?? [],
	);
	const allTokenDeltas = scenarios.flatMap((s) => perScenario[s]?.tokenDeltas ?? []);
	const allToolDeltas = scenarios.flatMap((s) => perScenario[s]?.toolDeltas ?? []);
	const gates = evaluateGates({
		perScenario,
		groundingNames,
		nRuns: runs.length,
		protocolTargetN: 10,
		groundingTokenDeltas,
	});
	const summary = buildSummaryObject({
		runs,
		scenarios,
		perScenario,
		groundingTokenDeltas,
		allTokenDeltas,
		allToolDeltas,
		gates,
	});
	return { scenarios, groundingTokenDeltas, gates, summary };
}

async function writeSummaryOutputs(
	outDir: string,
	ctx: ReturnType<typeof buildAggregateContext>,
	runs: RunFile[],
): Promise<void> {
	const { scenarios, groundingTokenDeltas, gates, summary } = ctx;
	await mkdir(outDir, { recursive: true });
	const jsonPath = join(outDir, "SUMMARY.json");
	const mdPath = join(outDir, "SUMMARY.md");
	await writeFile(jsonPath, `${JSON.stringify(summary, null, "\t")}\n`, "utf8");
	await writeFile(
		mdPath,
		buildSummaryMarkdown({ summary, runs, scenarios, groundingTokenDeltas, gates }),
	);
	console.log(`Wrote ${jsonPath}`);
	console.log(`Wrote ${mdPath}`);
	console.log(
		`N=${runs.length} preliminary=${gates.preliminary} groundingGate=${gates.groundingGate} tokenGate=${gates.tokenGate}`,
	);
}

async function main(): Promise<void> {
	const { runsDir, outDir } = parseCompareArgs(process.argv.slice(2));
	const runs = await collectRuns(runsDir);
	if (runs.length === 0) {
		console.error(`No compare-report.json files under ${runsDir}`);
		console.error("Deposit runs after: bun run agent:test:live:compare");
		process.exit(1);
	}
	await writeSummaryOutputs(outDir, buildAggregateContext(runs), runs);
}

await main();
