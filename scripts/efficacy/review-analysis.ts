/** One assessed review run: what it found and what it cost. */
export type ReviewRunResult = {
	found: Record<string, boolean>;
	tokens: number;
	/** Ran the bundle and stayed in it. Meaningless on the bare-diff side. */
	usedBundle: boolean;
};
export type ReviewPairResult = { baseline: ReviewRunResult; withSkeleton: ReviewRunResult };
export type FixtureResult = { fixture: string; defects: string[]; pairs: ReviewPairResult[] };
export type Interval = { estimate: number; low: number; high: number };

/** The bars the test must clear, set before the runs they judge. See docs/developer/efficacy.md. */
export const RELIABILITY_BARS = {
	minJudgeTextAgreement: 0.95,
	minAssessedFraction: 0.9,
	minBundleUse: 0.8,
	maxNullHalfWidth: 0.15,
	minSplitHalfAgreement: 0.95,
} as const;
const NO_EFFECT_MARGIN = 0.05;
const MAX_TOKEN_RATIO = 1.25;
const RESAMPLES = 10_000;
const SPLITS = 1_000;
const SEED = 20261101;

/** Small seeded generator, so the same runs always report the same interval. */
function seededRandom(seed: number): () => number {
	let state = seed >>> 0;
	return () => {
		state = (state + 0x6d2b79f5) >>> 0;
		let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
		mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
		return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
	};
}

function mean(values: number[]): number {
	if (values.length === 0) throw new Error("A mean needs at least one value.");
	return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function recall(run: ReviewRunResult, defects: string[]): number {
	return defects.filter((defect) => run.found[defect]).length / defects.length;
}

function recallDifferences(fixture: FixtureResult): number[] {
	return fixture.pairs.map(
		(pair) => recall(pair.withSkeleton, fixture.defects) - recall(pair.baseline, fixture.defects),
	);
}

function percentileInterval(estimate: number, samples: number[]): Interval {
	const sorted = [...samples].sort((a, b) => a - b);
	const at = (fraction: number) => sorted[Math.floor(fraction * (sorted.length - 1))] as number;
	return { estimate, low: at(0.025), high: at(0.975) };
}

/**
 * Bootstrap a mean over fixtures, resampling pairs within each. Every fixture weighs the same, so a
 * fixture cannot dominate by having more pairs, and pairs stay intact, which removes shared task noise.
 */
function stratifiedInterval(strata: number[][], seed = SEED): Interval {
	const random = seededRandom(seed);
	const samples = Array.from({ length: RESAMPLES }, () =>
		mean(
			strata.map((values) =>
				mean(values.map(() => values[Math.floor(random() * values.length)] as number)),
			),
		),
	);
	return percentileInterval(mean(strata.map(mean)), samples);
}

/** Skeleton minus bare diff, as a fraction of the known defects found per run. */
export function recallDifference(fixtures: FixtureResult[]): Interval {
	return stratifiedInterval(fixtures.map(recallDifferences));
}

/** Skeleton tokens over bare-diff tokens, as a geometric mean across pairs. */
export function tokenRatio(fixtures: FixtureResult[]): Interval {
	const logs = fixtures.map((fixture) =>
		fixture.pairs.map((pair) => Math.log(pair.withSkeleton.tokens / pair.baseline.tokens)),
	);
	const interval = stratifiedInterval(logs);
	return {
		estimate: Math.exp(interval.estimate),
		low: Math.exp(interval.low),
		high: Math.exp(interval.high),
	};
}

function binomial(count: number, trials: number): number {
	let value = 1;
	for (let index = 1; index <= count; index++) value *= (trials - count + index) / index;
	return value * 0.5 ** trials;
}

/** Two-sided exact McNemar test on the pairs where only one side found the defect. */
export function mcnemarExact(onlySkeleton: number, onlyBaseline: number): number {
	const discordant = onlySkeleton + onlyBaseline;
	if (discordant === 0) return 1;
	let tail = 0;
	for (let count = 0; count <= Math.min(onlySkeleton, onlyBaseline); count++)
		tail += binomial(count, discordant);
	return Math.min(1, 2 * tail);
}

export function defectComparison(fixture: FixtureResult) {
	return fixture.defects.map((defect) => {
		const skeleton = fixture.pairs.filter((pair) => pair.withSkeleton.found[defect]).length;
		const baseline = fixture.pairs.filter((pair) => pair.baseline.found[defect]).length;
		const onlySkeleton = fixture.pairs.filter(
			(pair) => pair.withSkeleton.found[defect] && !pair.baseline.found[defect],
		).length;
		const onlyBaseline = fixture.pairs.filter(
			(pair) => pair.baseline.found[defect] && !pair.withSkeleton.found[defect],
		).length;
		return { defect, skeleton, baseline, p: mcnemarExact(onlySkeleton, onlyBaseline) };
	});
}

/** How often two random halves of the pairs each point the same way as all of them. */
export function splitHalfAgreement(fixtures: FixtureResult[]): number {
	const whole = recallDifference(fixtures).estimate;
	const random = seededRandom(SEED + 1);
	let agreeing = 0;
	for (let split = 0; split < SPLITS; split++) {
		const halves = [0, 1].map(() => [] as number[][]);
		for (const fixture of fixtures) {
			const shuffled = recallDifferences(fixture)
				.map((value) => ({ value, order: random() }))
				.sort((a, b) => a.order - b.order)
				.map((item) => item.value);
			const middle = Math.floor(shuffled.length / 2);
			halves[0]?.push(shuffled.slice(0, middle));
			halves[1]?.push(shuffled.slice(middle));
		}
		const agree = halves.every((half) => Math.sign(mean(half.map(mean))) === Math.sign(whole));
		if (agree) agreeing++;
	}
	return agreeing / SPLITS;
}

export type FeatureVerdict = "helps" | "no-meaningful-effect" | "mixed" | "inconclusive";

/** The decision rule, fixed before the runs. An interval that spans both answers stays inconclusive. */
export function featureVerdict(fixtures: FixtureResult[]): FeatureVerdict {
	const pooled = recallDifference(fixtures);
	const tokens = tokenRatio(fixtures);
	const fixtureIntervals = fixtures.map((fixture) => recallDifference([fixture]));
	if (fixtureIntervals.some((interval) => interval.high < 0)) return "mixed";
	if (pooled.low > 0 && tokens.high <= MAX_TOKEN_RATIO) return "helps";
	if (pooled.low >= -NO_EFFECT_MARGIN && pooled.high <= NO_EFFECT_MARGIN)
		return "no-meaningful-effect";
	return "inconclusive";
}

/** The answer must survive losing any one fixture, or it belongs to that fixture alone. */
export function leaveOneFixtureOut(fixtures: FixtureResult[]) {
	return fixtures.map((left) => ({
		without: left.fixture,
		difference: recallDifference(fixtures.filter((fixture) => fixture !== left)),
	}));
}

export type InstrumentEvidence = {
	assessedFraction: Record<string, number>;
	judgeTextAgreement: number;
	bundleUse: number;
	nullRound: FixtureResult | null;
};

/** Reliability is about the instrument, so a test can pass this whichever side wins. */
export function reliabilityChecks(fixtures: FixtureResult[], evidence: InstrumentEvidence) {
	const bars = RELIABILITY_BARS;
	const nullInterval = evidence.nullRound ? recallDifference([evidence.nullRound]) : null;
	const pooledSign = Math.sign(recallDifference(fixtures).estimate);
	return {
		judgeAudit: evidence.judgeTextAgreement >= bars.minJudgeTextAgreement,
		assessed: Object.values(evidence.assessedFraction).every(
			(fraction) => fraction >= bars.minAssessedFraction,
		),
		bundleUse: evidence.bundleUse >= bars.minBundleUse,
		nullCoversZero: nullInterval !== null && nullInterval.low <= 0 && nullInterval.high >= 0,
		nullIsTight:
			nullInterval !== null && (nullInterval.high - nullInterval.low) / 2 <= bars.maxNullHalfWidth,
		splitHalf: splitHalfAgreement(fixtures) >= bars.minSplitHalfAgreement,
		leaveOneOut: leaveOneFixtureOut(fixtures).every(
			(result) => Math.sign(result.difference.estimate) === pooledSign,
		),
	};
}
