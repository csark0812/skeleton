#!/usr/bin/env bun
/**
 * Build curated transcript excerpts from suite-report.json files in a run dir.
 *
 * Usage:
 *   bun scripts/agent-evidence/excerpt-transcript.ts \
 *     --run-dir agent-suites/evidence/runs/2026-07-17-run-001 \
 *     --out-dir agent-suites/evidence/transcripts
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import process from "node:process";

interface ToolCall {
	name: string;
	args?: Record<string, unknown>;
	result?: string;
	seq?: number;
}

interface Message {
	role: string;
	content: string;
	seq?: number;
}

interface ScenarioResult {
	suite: string;
	scenario: string;
	passed: boolean;
	failures: Array<{ matcher: string; message: string; category?: string; evidence?: string }>;
	durationMs: number;
	usage?: { totalTokens?: number; inputTokens?: number; outputTokens?: number };
	judgeVerdicts?: Array<{ question: string; pass: boolean; rationale: string }>;
	trace?: {
		messages: Message[];
		toolCalls: ToolCall[];
		shellCommands?: string[];
	};
}

interface SuiteReport {
	suite: string;
	results: ScenarioResult[];
}

const SCENARIO_SLUGS: Record<string, string> = {
	"grounding: canonical topic": "grounding-canonical",
	"grounding: conflicting docs": "grounding-conflicting",
	"routing: docs-only change": "routing-docs-only",
};

function redactPath(text: string): string {
	return text
		.replace(/\/var\/folders\/[^"'\s]+\/agent-harness-wt-[^/"'\s]+/g, "<worktree>")
		.replace(/\/Users\/[^/"'\s]+\/Repositories\/skeleton/g, "<repo>");
}

function shortArgs(args: Record<string, unknown> | undefined): string {
	if (!args) return "";
	const raw = JSON.stringify(args);
	const redacted = redactPath(raw);
	return redacted.length > 160 ? `${redacted.slice(0, 160)}…` : redacted;
}

function excerptFailures(result: ScenarioResult): string {
	if (result.failures.length === 0) return "_none_";
	return result.failures.map((f) => `- \`${f.matcher}\`: ${redactPath(f.message)}`).join("\n");
}

function excerptJudges(result: ScenarioResult): string {
	if (!result.judgeVerdicts?.length) return "_none_";
	return result.judgeVerdicts
		.map(
			(j) =>
				`- **${j.pass ? "pass" : "fail"}:** ${j.question}\n  - ${redactPath(j.rationale).slice(0, 400)}`,
		)
		.join("\n");
}

function excerptTools(trace: ScenarioResult["trace"]): string {
	const tools = (trace?.toolCalls ?? []).slice(0, 12);
	if (tools.length === 0) return "_none_";
	return tools.map((t, i) => `${i + 1}. \`${t.name}\` ${shortArgs(t.args)}`).join("\n");
}

function excerptMetadataTable(result: ScenarioResult, arm: string): string {
	const trace = result.trace;
	return [
		`| Field | Value |`,
		`| ----- | ----- |`,
		`| Arm | ${arm} (\`${result.suite}\`) |`,
		`| Passed | ${result.passed} |`,
		`| Duration | ${result.durationMs} ms |`,
		`| Total tokens | ${result.usage?.totalTokens ?? "—"} |`,
		`| Tool calls (trace) | ${trace?.toolCalls.length ?? 0} |`,
	].join("\n");
}

function excerptAssistantTurns(result: ScenarioResult): string {
	const assistants = (result.trace?.messages ?? []).filter((m) => m.role === "assistant");
	const first = assistants[0]?.content?.trim() ?? "";
	const last = assistants[assistants.length - 1]?.content?.trim() ?? "";
	return [
		"## Assistant (first turn)",
		"",
		"```",
		redactPath(first).slice(0, 800) || "(empty)",
		"```",
		"",
		"## Assistant (final)",
		"",
		"```",
		redactPath(last).slice(0, 1200) || "(empty)",
		"```",
		"",
	].join("\n");
}

function excerptFor(result: ScenarioResult, arm: "clean" | "messy"): string {
	return [
		`# ${result.scenario} — ${arm}`,
		"",
		`<!-- curated excerpt from live suite report; paths redacted -->`,
		"",
		excerptMetadataTable(result, arm),
		"",
		"## Rubric failures",
		"",
		excerptFailures(result),
		"",
		"## Judge",
		"",
		excerptJudges(result),
		"",
		"## Tools (first 12)",
		"",
		excerptTools(result.trace),
		"",
		excerptAssistantTurns(result),
	].join("\n");
}

async function loadSuite(path: string): Promise<SuiteReport> {
	return JSON.parse(await readFile(path, "utf8")) as SuiteReport;
}

function parseExcerptArgs(argv: string[]): { runDir: string; outDir: string } {
	let runDir = "";
	let outDir = resolve("agent-suites/evidence/transcripts");
	for (let i = 0; i < argv.length; i++) {
		if (argv[i] === "--run-dir" && argv[i + 1]) runDir = resolve(argv[++i]!);
		else if (argv[i] === "--out-dir" && argv[i + 1]) outDir = resolve(argv[++i]!);
	}
	return { runDir, outDir };
}

interface WriteScenarioExcerptsInput {
	outDir: string;
	clean: SuiteReport;
	messy: SuiteReport;
}

async function writeScenarioExcerpts(input: WriteScenarioExcerptsInput): Promise<void> {
	const { outDir, clean, messy } = input;
	for (const [scenario, slug] of Object.entries(SCENARIO_SLUGS)) {
		const c = clean.results.find((r) => r.scenario === scenario);
		const m = messy.results.find((r) => r.scenario === scenario);
		if (!(c && m)) {
			console.warn(`skip missing scenario: ${scenario}`);
			continue;
		}
		const dir = join(outDir, slug);
		await mkdir(dir, { recursive: true });
		await writeFile(join(dir, "clean.excerpt.md"), excerptFor(c, "clean"), "utf8");
		await writeFile(join(dir, "messy.excerpt.md"), excerptFor(m, "messy"), "utf8");
		console.log(`wrote ${slug}/`);
	}
}

async function main(): Promise<void> {
	const { runDir, outDir } = parseExcerptArgs(process.argv.slice(2));
	if (!runDir) {
		console.error("Usage: excerpt-transcript.ts --run-dir <runs/…> [--out-dir …]");
		process.exit(1);
	}

	const clean = await loadSuite(join(runDir, "skeleton-clean.suite-report.json"));
	const messy = await loadSuite(join(runDir, "skeleton-messy.suite-report.json"));
	await writeScenarioExcerpts({ outDir, clean, messy });
}

await main();
