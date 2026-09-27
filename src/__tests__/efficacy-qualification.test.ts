import { describe, expect, it } from "bun:test";
import { AgentInfrastructureError } from "@post-print/agent-harness";
import type { Run } from "@post-print/agent-test";
import type { Outcome } from "../../scripts/efficacy/measurements.ts";
import {
	evaluateQualification,
	type QualificationCell,
	resolveInfrastructureRetry,
} from "../../scripts/efficacy/qualification.ts";
import {
	assessWithEvaluationRetry,
	runWithInfrastructureRetry,
	shouldRetryEvaluation,
} from "../../scripts/efficacy/retries.ts";

const correct = (tokens: number, extra: Partial<Outcome> = {}): Outcome => ({
	status: "correct",
	reason: "verified",
	tokens,
	...extra,
});
const incorrect = (tokens = 1): Outcome => ({ status: "incorrect", reason: "wrong", tokens });
const pair = (baselineTokens: number, treatmentTokens: number) => ({
	baseline: correct(baselineTokens),
	withSkeleton: correct(treatmentTokens),
});
const core = (id: string, ratio = 0.6, scale = 1_000): QualificationCell => ({
	id,
	repository: `public/${id}`,
	tier: "core",
	pairs: Array.from({ length: 10 }, () => pair(scale, scale * ratio)),
});

const recovery = (id: string): QualificationCell => ({
	id,
	repository: `public/${id}`,
	tier: "recovery",
	pairs: Array.from({ length: 10 }, () => pair(1_000, 1_000)),
});
const trivial = (): QualificationCell => ({
	id: "hono-trivial-edit",
	repository: "honojs/hono",
	tier: "trivial",
	pairs: Array.from({ length: 10 }, () => pair(1_000, 1_150)),
});
const adoption = (): QualificationCell => ({
	id: "biome-adoption",
	repository: "biomejs/biome",
	tier: "adoption",
	pairs: Array.from({ length: 10 }, () => ({
		baseline: correct(1_000),
		withSkeleton: {
			...correct(1_650),
			setupTokens: 600,
			maintenanceTokens: 1_050,
			setupVerified: true,
		},
	})),
});
const passingCells = () => [
	...Array.from({ length: 8 }, (_, index) => core(`core-${index + 1}`)),
	recovery("fastapi-missing-metadata"),
	recovery("ruff-truncated-context"),
	trivial(),
	adoption(),
];

describe("broader OpenAI qualification gates", () => {
	it("passes the preregistered core and guardrail contract", () => {
		const report = evaluateQualification(passingCells(), { bootstrapSamples: 1_000, seed: 42 });
		expect(report.passed).toBe(true);
		expect(report.core.pointReduction).toBeCloseTo(0.4);
		expect(report.core.lowerConfidenceReduction).toBeCloseTo(0.4);
		expect(report.gates.every((gate) => gate.passed)).toBe(true);
	});

	it("is deterministic for a fixed stratified bootstrap seed", () => {
		const first = evaluateQualification(passingCells(), { bootstrapSamples: 2_000, seed: 73 });
		const second = evaluateQualification(passingCells(), { bootstrapSamples: 2_000, seed: 73 });
		expect(second.core.lowerConfidenceReduction).toBe(first.core.lowerConfidenceReduction);
	});

	it("uses the preregistered 100000 stratified bootstrap resamples by default", () => {
		const report = evaluateQualification(passingCells());
		expect(report.bootstrap.samples).toBe(100_000);
		expect(report.bootstrap.seed).toBe(20_260_901);
	});

	it("accepts exact overhead threshold boundaries", () => {
		const cells = passingCells();
		cells[10] = { ...trivial(), pairs: Array.from({ length: 10 }, () => pair(1_000, 1_200)) };
		expect(
			evaluateQualification(cells, { bootstrapSamples: 1_000, seed: 42 }).gates.find(
				(gate) => gate.id === "hono-trivial-edit:overhead",
			)?.passed,
		).toBe(true);
	});

	it("accepts exact correctness, matched-pair, and total-correctness boundaries", () => {
		const cells = passingCells();
		const marginalCore = cells[0]!;
		marginalCore.pairs = marginalCore.pairs.map((attempt, index) => ({
			baseline: index === 1 ? incorrect() : attempt.baseline,
			withSkeleton: index === 0 ? incorrect() : attempt.withSkeleton,
		}));
		const oneBehindCore = cells[1]!;
		oneBehindCore.pairs[0]!.withSkeleton = incorrect();
		const oneAheadCore = cells[2]!;
		oneAheadCore.pairs[0]!.baseline = incorrect();
		const marginalRecovery = cells[8]!;
		marginalRecovery.pairs = marginalRecovery.pairs.map((attempt, index) => ({
			baseline: index === 0 ? correct(1_000) : index === 1 ? incorrect() : attempt.baseline,
			withSkeleton: index === 0 ? incorrect() : index === 1 ? correct(1_000) : attempt.withSkeleton,
		}));

		const report = evaluateQualification(cells, { bootstrapSamples: 1_000, seed: 42 });
		expect(report.gates.find((gate) => gate.id === "core-total-correctness")).toMatchObject({
			passed: true,
			actual: 0,
		});
		expect(report.gates.find((gate) => gate.id === "core-1:matched-pairs")?.actual).toBe(8);
		expect(report.gates.find((gate) => gate.id === "core-1:skeleton-correct")?.actual).toBe(9);
		expect(report.gates.find((gate) => gate.id === "core-2:correctness-gap")?.actual).toBe(-1);
		expect(
			report.gates.find((gate) => gate.id === "fastapi-missing-metadata:matched-pairs")?.actual,
		).toBe(8);
		expect(report.passed).toBe(true);
	});

	it("accepts the exact 35% point-reduction boundary", () => {
		const cells = passingCells();
		cells.splice(0, 8, ...Array.from({ length: 8 }, (_, index) => core(`core-${index + 1}`, 0.65)));
		const report = evaluateQualification(cells, { bootstrapSamples: 1_000, seed: 42 });
		expect(report.core.pointReduction).toBeCloseTo(0.35, 12);
		expect(report.gates.find((gate) => gate.id === "core-point-reduction")?.passed).toBe(true);
	});

	it("accepts the exact 20% confidence-floor boundary", () => {
		const cells = passingCells();
		cells.splice(0, 8, ...Array.from({ length: 8 }, (_, index) => core(`core-${index + 1}`, 0.8)));
		const report = evaluateQualification(cells, { bootstrapSamples: 1_000, seed: 42 });
		expect(report.core.lowerConfidenceReduction).toBeCloseTo(0.2, 12);
		expect(report.gates.find((gate) => gate.id === "core-confidence-floor")?.passed).toBe(true);
	});

	it("accepts exactly six positive cells and the 15% regression ceiling", () => {
		const cells = passingCells();
		cells.splice(
			0,
			8,
			...Array.from({ length: 6 }, (_, index) => core(`saving-${index + 1}`, 0.5)),
			core("regression-a", 1.15),
			core("regression-b", 1.15),
		);
		const report = evaluateQualification(cells, { bootstrapSamples: 1_000, seed: 42 });
		expect(report.core.positiveCells).toBe(6);
		expect(report.gates.find((gate) => gate.id === "core-positive-cells")?.passed).toBe(true);
		expect(report.gates.find((gate) => gate.id === "core-max-regression")?.passed).toBe(true);
	});

	it("accepts exact trivial-edit and adoption guardrail boundaries", () => {
		const cells = passingCells();
		cells[10] = {
			...trivial(),
			pairs: [
				...Array.from({ length: 9 }, () => pair(1_000, 1_200)),
				{ baseline: incorrect(), withSkeleton: correct(1_200) },
			],
		};
		cells[11] = {
			...adoption(),
			pairs: [
				...Array.from({ length: 9 }, () => ({
					baseline: correct(1_000),
					withSkeleton: {
						...correct(2_400),
						setupTokens: 1_200,
						maintenanceTokens: 1_200,
						setupVerified: true,
					},
				})),
				{ baseline: incorrect(), withSkeleton: incorrect() },
			],
		};

		const report = evaluateQualification(cells, { bootstrapSamples: 1_000, seed: 42 });
		expect(report.gates.find((gate) => gate.id === "hono-trivial-edit:matched-pairs")?.actual).toBe(
			9,
		);
		expect(report.gates.find((gate) => gate.id === "hono-trivial-edit:overhead")?.passed).toBe(
			true,
		);
		expect(report.gates.find((gate) => gate.id === "biome-adoption:skeleton-correct")?.actual).toBe(
			9,
		);
		expect(report.gates.find((gate) => gate.id === "biome-adoption:baseline-correct")?.actual).toBe(
			9,
		);
		expect(report.gates.find((gate) => gate.id === "biome-adoption:setup-sequence")?.actual).toBe(
			9,
		);
		expect(
			report.gates.find((gate) => gate.id === "biome-adoption:maintenance-overhead")?.passed,
		).toBe(true);
		expect(report.gates.find((gate) => gate.id === "biome-adoption:amortization")?.actual).toBe(3);
		expect(report.gates.find((gate) => gate.id === "biome-adoption:amortization")?.passed).toBe(
			true,
		);
	});

	it("equal-weights cells so one expensive success cannot dominate seven weak cells", () => {
		const cells = passingCells();
		cells.splice(
			0,
			8,
			core("huge", 0.1, 1_000_000),
			...Array.from({ length: 7 }, (_, index) => core(`weak-${index + 1}`, 0.9)),
		);
		const report = evaluateQualification(cells, { bootstrapSamples: 1_000, seed: 42 });
		expect(report.core.pointReduction).toBeLessThan(0.35);
		expect(report.gates.find((gate) => gate.id === "core-point-reduction")?.passed).toBe(false);
	});

	it("never counts cheap incorrect work as a matched efficiency pair", () => {
		const cells = passingCells();
		const target = cells[0]!;
		target.pairs = [
			...Array.from({ length: 7 }, () => pair(1_000, 600)),
			...Array.from({ length: 3 }, () => ({
				baseline: correct(1_000),
				withSkeleton: incorrect(1),
			})),
		];
		const report = evaluateQualification(cells, { bootstrapSamples: 1_000, seed: 42 });
		expect(report.cells[0]?.matchedPairs).toBe(7);
		expect(report.gates.find((gate) => gate.id === `${target.id}:matched-pairs`)?.passed).toBe(
			false,
		);
	});

	it("fails when one core cell regresses by more than fifteen percent", () => {
		const cells = passingCells();
		cells[0] = core("regression", 1.16);
		const report = evaluateQualification(cells, { bootstrapSamples: 1_000, seed: 42 });
		expect(report.gates.find((gate) => gate.id === "core-max-regression")?.passed).toBe(false);
	});

	it("keeps guardrail failures independent from core savings", () => {
		const cells = passingCells();
		cells[10] = { ...trivial(), pairs: Array.from({ length: 10 }, () => pair(1_000, 1_210)) };
		const report = evaluateQualification(cells, { bootstrapSamples: 1_000, seed: 42 });
		expect(report.core.pointReduction).toBeCloseTo(0.4);
		expect(report.gates.find((gate) => gate.id === "hono-trivial-edit:overhead")?.passed).toBe(
			false,
		);
		expect(report.passed).toBe(false);
	});

	it("requires adoption setup cost to amortize within three core tasks", () => {
		const cells = passingCells();
		cells[11] = {
			...adoption(),
			pairs: Array.from({ length: 10 }, () => ({
				baseline: correct(1_000),
				withSkeleton: { ...correct(3_050), setupTokens: 2_000, maintenanceTokens: 1_050 },
			})),
		};
		const report = evaluateQualification(cells, { bootstrapSamples: 1_000, seed: 42 });
		expect(report.gates.find((gate) => gate.id === "biome-adoption:amortization")?.passed).toBe(
			false,
		);
	});

	it("retries infrastructure errors once but never retries incorrect work", () => {
		const error: Outcome = { status: "execution-error", reason: "provider unavailable" };
		expect(resolveInfrastructureRetry(error, correct(600))).toMatchObject({
			outcome: { status: "correct", tokens: 600 },
			retried: true,
			original: error,
		});
		expect(() => resolveInfrastructureRetry(incorrect(), correct(600))).toThrow(
			"Only infrastructure errors may be retried",
		);
		expect(resolveInfrastructureRetry(error)).toMatchObject({
			outcome: error,
			retried: false,
			original: error,
		});
	});

	it("retries only SDK-classified execution failures and retains the original error", async () => {
		const original = new AgentInfrastructureError("host timeout", "timeout", 100);
		let calls = 0;
		const result = await runWithInfrastructureRetry(async () => {
			calls++;
			if (calls === 1) throw original;
			return "recovered";
		});
		expect(calls).toBe(2);
		expect(result).toMatchObject({ status: "fulfilled", value: "recovered", original });

		calls = 0;
		const applicationError = new Error("incorrect agent result");
		const unclassified = await runWithInfrastructureRetry(async () => {
			calls++;
			throw applicationError;
		});
		expect(calls).toBe(1);
		expect(unclassified).toEqual({ status: "rejected", reason: applicationError });
	});

	it("retries judge evaluations only when the SDK classifies infrastructure failure", () => {
		expect(shouldRetryEvaluation(true)).toBe(true);
		expect(shouldRetryEvaluation(false)).toBe(false);
	});

	it("uses at most one retry across execution and evaluation", async () => {
		const run = {
			id: "agent-run",
			usage: { tokens: { total: 100 } },
			durationMs: 1,
		} as Run;
		const original = new AgentInfrastructureError("host timeout", "timeout", 100);
		let evaluations = 0;
		const afterExecutionRetry = await assessWithEvaluationRetry(
			{ status: "fulfilled", value: run, original },
			async () => {
				evaluations++;
				throw new AgentInfrastructureError("judge timeout", "timeout", 100);
			},
		);
		expect(evaluations).toBe(1);
		expect(afterExecutionRetry.status).toBe("evaluation-error");
		expect(afterExecutionRetry.retry).toEqual({
			kind: "execution",
			originalError: "host timeout",
		});

		evaluations = 0;
		const afterEvaluationRetry = await assessWithEvaluationRetry(
			{ status: "fulfilled", value: run },
			async () => {
				evaluations++;
				if (evaluations === 1) throw new AgentInfrastructureError("judge timeout", "timeout", 100);
				return { checks: { answer: true }, reason: "verified" };
			},
		);
		expect(evaluations).toBe(2);
		expect(afterEvaluationRetry.status).toBe("correct");
		expect(afterEvaluationRetry.retry).toEqual({
			kind: "evaluation",
			originalError: "judge timeout",
		});
	});
});
