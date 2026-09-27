import type { Outcome, Pair } from "./measurements.ts";
import { median } from "./median.ts";

export type QualificationTier = "core" | "recovery" | "trivial" | "adoption";

export type QualificationOutcome = Outcome & {
	setupTokens?: number;
	maintenanceTokens?: number;
	setupVerified?: boolean;
};

export type QualificationPair = {
	baseline: QualificationOutcome;
	withSkeleton: QualificationOutcome;
};

export type QualificationCell = {
	id: string;
	repository: string;
	tier: QualificationTier;
	pairs: QualificationPair[];
};

export type QualificationGate = {
	id: string;
	passed: boolean;
	actual: number | string | null;
	required: string;
};

export type QualificationCellSummary = {
	id: string;
	repository: string;
	tier: QualificationTier;
	attempts: number;
	baselineCorrect: number;
	skeletonCorrect: number;
	matchedPairs: number;
	pairedRatios: number[];
	medianPairedRatio: number | null;
	medianAbsoluteSavings: number | null;
};

export type QualificationReport = {
	version: "broader-openai-v1";
	passed: boolean;
	cells: QualificationCellSummary[];
	core: {
		cellRatio: number | null;
		pointReduction: number | null;
		lowerConfidenceReduction: number | null;
		positiveCells: number;
		medianAbsoluteSavings: number | null;
	};
	gates: QualificationGate[];
	bootstrap: { samples: number; seed: number };
};

type EvaluationOptions = { bootstrapSamples?: number; seed?: number };

const EXPECTED_ATTEMPTS = 10;
const EPSILON = 1e-12;

export function resolveInfrastructureRetry(
	original: QualificationOutcome,
	retry?: QualificationOutcome,
) {
	const isInfrastructureError =
		original.status === "execution-error" || original.status === "evaluation-error";
	if (retry && !isInfrastructureError)
		throw new Error("Only infrastructure errors may be retried.");
	return {
		outcome: retry ?? original,
		retried: retry !== undefined,
		original,
	};
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity lint/complexity/noExcessiveLinesPerFunction: Keeping every preregistered gate in one pure evaluator makes the claim decision auditable as a unit.
export function evaluateQualification(
	cells: QualificationCell[],
	options: EvaluationOptions = {},
): QualificationReport {
	const bootstrapSamples = options.bootstrapSamples ?? 100_000;
	const seed = options.seed ?? 20_260_901;
	if (!Number.isInteger(bootstrapSamples) || bootstrapSamples < 1)
		throw new Error("bootstrapSamples must be a positive integer.");
	if (!Number.isInteger(seed)) throw new Error("seed must be an integer.");

	const summaries = cells.map(summarizeCell);
	const coreCells = summaries.filter((cell) => cell.tier === "core");
	const recoveryCells = summaries.filter((cell) => cell.tier === "recovery");
	const trivialCells = summaries.filter((cell) => cell.tier === "trivial");
	const adoptionCells = summaries.filter((cell) => cell.tier === "adoption");
	const gates: QualificationGate[] = [
		gate("matrix-cell-count", cells.length === 12, cells.length, "exactly 12 cells"),
		gate("matrix-core-count", coreCells.length === 8, coreCells.length, "exactly 8 core cells"),
		gate(
			"matrix-recovery-count",
			recoveryCells.length === 2,
			recoveryCells.length,
			"exactly 2 recovery cells",
		),
		gate(
			"matrix-trivial-count",
			trivialCells.length === 1,
			trivialCells.length,
			"exactly 1 trivial cell",
		),
		gate(
			"matrix-adoption-count",
			adoptionCells.length === 1,
			adoptionCells.length,
			"exactly 1 adoption cell",
		),
	];

	for (const cell of summaries)
		gates.push(
			gate(
				`${cell.id}:attempts`,
				cell.attempts === EXPECTED_ATTEMPTS,
				cell.attempts,
				"exactly 10 paired attempts",
			),
		);

	for (const cell of [...coreCells, ...recoveryCells]) {
		gates.push(
			gate(
				`${cell.id}:skeleton-correct`,
				cell.skeletonCorrect >= 9,
				cell.skeletonCorrect,
				"at least 9 correct Skeleton attempts",
			),
			gate(
				`${cell.id}:matched-pairs`,
				cell.matchedPairs >= 8,
				cell.matchedPairs,
				"at least 8 matched-correct measurable pairs",
			),
			gate(
				`${cell.id}:correctness-gap`,
				cell.skeletonCorrect >= cell.baselineCorrect - 1,
				cell.skeletonCorrect - cell.baselineCorrect,
				"Skeleton trails baseline by no more than 1 correct attempt",
			),
		);
	}

	const coreRatios = coreCells
		.map((cell) => cell.medianPairedRatio)
		.filter((value): value is number => value !== null);
	const aggregateRatio = coreRatios.length === 8 ? geometricMean(coreRatios) : null;
	const pointReduction = aggregateRatio === null ? null : 1 - aggregateRatio;
	const lowerConfidenceReduction =
		coreCells.length === 8 && coreCells.every((cell) => cell.pairedRatios.length > 0)
			? bootstrapLowerReduction(coreCells, bootstrapSamples, seed)
			: null;
	const positiveCells = coreCells.filter(
		(cell) => cell.medianPairedRatio !== null && cell.medianPairedRatio < 1,
	).length;
	const coreMedianAbsoluteSavings = nullableMedian(
		coreCells
			.map((cell) => cell.medianAbsoluteSavings)
			.filter((value): value is number => value !== null),
	);

	const baselineCoreCorrect = sum(coreCells.map((cell) => cell.baselineCorrect));
	const skeletonCoreCorrect = sum(coreCells.map((cell) => cell.skeletonCorrect));
	gates.push(
		gate(
			"core-total-correctness",
			skeletonCoreCorrect >= baselineCoreCorrect,
			skeletonCoreCorrect - baselineCoreCorrect,
			"Skeleton total correct count is at least baseline",
		),
		gate(
			"core-point-reduction",
			pointReduction !== null && pointReduction + EPSILON >= 0.35,
			pointReduction,
			"at least 35% equal-weighted token reduction",
		),
		gate(
			"core-confidence-floor",
			lowerConfidenceReduction !== null && lowerConfidenceReduction + EPSILON >= 0.2,
			lowerConfidenceReduction,
			"one-sided 95% bootstrap lower reduction is at least 20%",
		),
		gate(
			"core-positive-cells",
			positiveCells >= 6,
			positiveCells,
			"at least 6 of 8 core cells reduce tokens",
		),
		gate(
			"core-max-regression",
			coreCells.every(
				(cell) => cell.medianPairedRatio !== null && cell.medianPairedRatio <= 1.15 + EPSILON,
			),
			coreCells.length
				? Math.max(...coreCells.map((cell) => cell.medianPairedRatio ?? Number.POSITIVE_INFINITY))
				: null,
			"no core cell has more than 15% median token regression",
		),
	);

	for (const cell of trivialCells) {
		gates.push(
			gate(
				`${cell.id}:skeleton-correct`,
				cell.skeletonCorrect === 10,
				cell.skeletonCorrect,
				"all 10 Skeleton attempts are correct",
			),
			gate(
				`${cell.id}:matched-pairs`,
				cell.matchedPairs >= 9,
				cell.matchedPairs,
				"at least 9 matched-correct measurable pairs",
			),
			gate(
				`${cell.id}:overhead`,
				cell.medianPairedRatio !== null && cell.medianPairedRatio <= 1.2 + EPSILON,
				cell.medianPairedRatio === null ? null : cell.medianPairedRatio - 1,
				"median paired token overhead is at most 20%",
			),
		);
	}

	for (const cell of adoptionCells) {
		const source = cells.find((candidate) => candidate.id === cell.id)!;
		const setupTokens = source.pairs
			.map((pair) => pair.withSkeleton.setupTokens)
			.filter((value): value is number => validToken(value));
		const maintenanceRatios = source.pairs
			.filter(isMatchedCorrect)
			.map((pair) => {
				const maintenance = pair.withSkeleton.maintenanceTokens;
				return validToken(maintenance) && validToken(pair.baseline.tokens)
					? maintenance / pair.baseline.tokens
					: null;
			})
			.filter((value): value is number => value !== null);
		const medianSetup = nullableMedian(setupTokens);
		const medianMaintenanceRatio = nullableMedian(maintenanceRatios);
		const amortizationTasks =
			medianSetup !== null && coreMedianAbsoluteSavings !== null && coreMedianAbsoluteSavings > 0
				? medianSetup / coreMedianAbsoluteSavings
				: null;
		gates.push(
			gate(
				`${cell.id}:skeleton-correct`,
				cell.skeletonCorrect >= 9,
				cell.skeletonCorrect,
				"at least 9 successful adoption and maintenance attempts",
			),
			gate(
				`${cell.id}:baseline-correct`,
				cell.baselineCorrect >= 9,
				cell.baselineCorrect,
				"at least 9 correct baseline maintenance attempts",
			),
			gate(
				`${cell.id}:setup-sequence`,
				source.pairs.filter((pair) => pair.withSkeleton.setupVerified === true).length >= 9,
				source.pairs.filter((pair) => pair.withSkeleton.setupVerified === true).length,
				"at least 9 verified install-initialize-maintain sequences",
			),
			gate(
				`${cell.id}:maintenance-overhead`,
				medianMaintenanceRatio !== null && medianMaintenanceRatio <= 1.2 + EPSILON,
				medianMaintenanceRatio === null ? null : medianMaintenanceRatio - 1,
				"maintenance-only median token overhead is at most 20%",
			),
			gate(
				`${cell.id}:amortization`,
				amortizationTasks !== null && amortizationTasks <= 3 + EPSILON,
				amortizationTasks,
				"median setup cost amortizes within 3 median core tasks",
			),
		);
	}

	return {
		version: "broader-openai-v1",
		passed: gates.every((entry) => entry.passed),
		cells: summaries,
		core: {
			cellRatio: aggregateRatio,
			pointReduction,
			lowerConfidenceReduction,
			positiveCells,
			medianAbsoluteSavings: coreMedianAbsoluteSavings,
		},
		gates,
		bootstrap: { samples: bootstrapSamples, seed },
	};
}

function summarizeCell(cell: QualificationCell): QualificationCellSummary {
	const matched = cell.pairs.filter(isMatchedCorrect);
	const pairedRatios = matched
		.map((pair) =>
			validToken(pair.baseline.tokens) && validToken(pair.withSkeleton.tokens)
				? pair.withSkeleton.tokens / pair.baseline.tokens
				: null,
		)
		.filter((value): value is number => value !== null);
	const absoluteSavings = matched
		.map((pair) =>
			validToken(pair.baseline.tokens) && validToken(pair.withSkeleton.tokens)
				? pair.baseline.tokens - pair.withSkeleton.tokens
				: null,
		)
		.filter((value): value is number => value !== null);
	return {
		id: cell.id,
		repository: cell.repository,
		tier: cell.tier,
		attempts: cell.pairs.length,
		baselineCorrect: cell.pairs.filter((pair) => pair.baseline.status === "correct").length,
		skeletonCorrect: cell.pairs.filter((pair) => pair.withSkeleton.status === "correct").length,
		matchedPairs: pairedRatios.length,
		pairedRatios,
		medianPairedRatio: nullableMedian(pairedRatios),
		medianAbsoluteSavings: nullableMedian(absoluteSavings),
	};
}

function isMatchedCorrect(pair: QualificationPair | Pair) {
	return pair.baseline.status === "correct" && pair.withSkeleton.status === "correct";
}

function bootstrapLowerReduction(cells: QualificationCellSummary[], samples: number, seed: number) {
	const random = mulberry32(seed);
	const reductions: number[] = [];
	for (let sample = 0; sample < samples; sample++) {
		const cellRatios = cells.map((cell) => {
			const selected = Array.from(
				{ length: cell.pairedRatios.length },
				() => cell.pairedRatios[Math.floor(random() * cell.pairedRatios.length)]!,
			);
			return median(selected);
		});
		reductions.push(1 - geometricMean(cellRatios));
	}
	reductions.sort((left, right) => left - right);
	return reductions[Math.floor(samples * 0.05)]!;
}

function geometricMean(values: number[]) {
	if (!values.length || values.some((value) => !Number.isFinite(value) || value <= 0))
		throw new Error("Geometric mean requires finite positive values.");
	return Math.exp(sum(values.map(Math.log)) / values.length);
}

// biome-ignore lint/complexity/useMaxParams: Gate call sites are clearer with the four claim fields in declaration order.
function gate(
	id: string,
	passed: boolean,
	actual: QualificationGate["actual"],
	required: string,
): QualificationGate {
	return { id, passed, actual, required };
}

function nullableMedian(values: number[]) {
	return values.length ? median(values) : null;
}

function validToken(value: number | undefined): value is number {
	return value !== undefined && Number.isFinite(value) && value > 0;
}

function sum(values: number[]) {
	return values.reduce((total, value) => total + value, 0);
}

function mulberry32(seed: number) {
	let state = seed >>> 0;
	return () => {
		state += 0x6d2b79f5;
		let value = state;
		value = Math.imul(value ^ (value >>> 15), value | 1);
		value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
		return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
	};
}
