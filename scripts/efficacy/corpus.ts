import { createHash } from "node:crypto";

export type CorpusTaskTier = "core" | "recovery" | "trivial" | "adoption";
export type CorpusTaskKind = "discovery" | "maintenance" | "guardrail";

export type QualificationVerifier = {
	kind: "judge" | "historical-patch" | "exact-edit" | "recovery" | "adoption";
	requirements: string[];
	expectedPaths: string[];
	verificationPaths?: string[];
	referenceCommit?: string;
	contentChecks?: Array<{ path: string; includes: string[]; excludes?: string[] }>;
	changedFileContentChecks?: Array<{ prefix: string; includes: string[] }>;
	recoveryEvidence?: {
		signal: "no-context" | "truncated-read";
		traceChecks: Array<{ needle: string; minimumOccurrences: number }>;
		fixture?: { path: string; content: string };
	};
	requiredChangedPaths?: string[];
	unchangedRustCodePaths?: string[];
};

export type QualificationCorpusTask = {
	id: string;
	repository: string;
	repositoryUrl: string;
	commit: string;
	tree: string;
	license: string;
	upstreamUrl: string;
	selectedBy: string;
	tier: CorpusTaskTier;
	kind: CorpusTaskKind;
	prompt: string;
	promptSha256: string;
	verifier: QualificationVerifier;
	verifierSha256: string;
	nativeTestCommand: string;
	warmTestTimeoutMs: number;
	requirements: string[];
};

export type QualificationCorpus = {
	version: "broader-openai-v1";
	status: "sealed";
	sealedAt: string;
	cutoff: "2026-09-01T00:00:00Z";
	model: "gpt-5.6-luna";
	judgeModel: "gpt-5.6-luna";
	globalSkills: false;
	repetitions: 10;
	bootstrap: { samples: 100_000; seed: number };
	tasks: QualificationCorpusTask[];
};

const COMMIT = /^[0-9a-f]{40}$/;
const SHA256 = /^sha256:[0-9a-f]{64}$/;
const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const FORBIDDEN_REQUIREMENT = /(android|ios|device|simulator|secret|credential|mutable-network)/i;
const FORBIDDEN_EVIDENCE = [
	"post-print/applications",
	"Repositories/PostPrint/applications",
	"private repo",
];

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity lint/complexity/noExcessiveLinesPerFunction: This is a linear fail-closed schema validator whose checks stay explicit and independently tested.
export function parseQualificationCorpus(value: unknown): QualificationCorpus {
	if (!isRecord(value)) throw new Error("Qualification corpus must be an object.");
	const corpus = value as QualificationCorpus;
	if (corpus.version !== "broader-openai-v1") throw new Error("Unsupported corpus version.");
	if (corpus.status !== "sealed") throw new Error("Qualification corpus must be sealed.");
	if (!Number.isFinite(Date.parse(corpus.sealedAt)))
		throw new Error("sealedAt must be an ISO date.");
	if (corpus.cutoff !== "2026-09-01T00:00:00Z") throw new Error("Unexpected corpus cutoff.");
	if (corpus.model !== "gpt-5.6-luna" || corpus.judgeModel !== "gpt-5.6-luna")
		throw new Error("Qualification agent and judge must use gpt-5.6-luna.");
	if (corpus.globalSkills !== false) throw new Error("Global skills must be disabled.");
	if (corpus.repetitions !== 10) throw new Error("Qualification requires exactly 10 repetitions.");
	if (corpus.bootstrap?.samples !== 100_000 || !Number.isInteger(corpus.bootstrap.seed))
		throw new Error("Qualification requires 100000 bootstrap samples and an integer seed.");
	if (!Array.isArray(corpus.tasks) || corpus.tasks.length !== 12)
		throw new Error("Qualification corpus must contain exactly 12 tasks.");

	const serialized = JSON.stringify(corpus);
	if (FORBIDDEN_EVIDENCE.some((needle) => serialized.includes(needle)))
		throw new Error("Qualification corpus contains private or forbidden evidence.");

	const ids = new Set<string>();
	const repositories = new Set<string>();
	for (const task of corpus.tasks) {
		if (!isRecord(task)) throw new Error("Every qualification task must be an object.");
		if (!ID.test(task.id)) throw new Error(`Invalid task id: ${task.id}`);
		if (ids.has(task.id)) throw new Error(`Duplicate task id: ${task.id}`);
		ids.add(task.id);
		if (!/^[a-z0-9_.-]+\/[a-z0-9_.-]+$/i.test(task.repository))
			throw new Error(`${task.id}: invalid repository identity.`);
		if (task.repositoryUrl !== `https://github.com/${task.repository}`)
			throw new Error(`${task.id}: repositoryUrl must be its public GitHub URL.`);
		if (!task.upstreamUrl?.startsWith(`https://github.com/${task.repository}/`))
			throw new Error(`${task.id}: upstreamUrl must identify public upstream evidence.`);
		repositories.add(task.repository);
		if (!(COMMIT.test(task.commit) && COMMIT.test(task.tree)))
			throw new Error(`${task.id}: commit and tree must be immutable 40-character hashes.`);
		if (!task.license?.trim()) throw new Error(`${task.id}: license is required.`);
		if (!task.selectedBy?.trim()) throw new Error(`${task.id}: selection evidence is required.`);
		if (!(["core", "recovery", "trivial", "adoption"] as unknown[]).includes(task.tier))
			throw new Error(`${task.id}: invalid tier.`);
		if (!(["discovery", "maintenance", "guardrail"] as unknown[]).includes(task.kind))
			throw new Error(`${task.id}: invalid task kind.`);
		if (typeof task.prompt !== "string" || task.prompt.trim().length < 20)
			throw new Error(`${task.id}: prompt must be a natural user request.`);
		if (!SHA256.test(task.promptSha256) || task.promptSha256 !== sha256(task.prompt))
			throw new Error(`${task.id}: promptSha256 does not match the prompt.`);
		validateVerifier(task.id, task.verifier);
		if (
			!SHA256.test(task.verifierSha256) ||
			task.verifierSha256 !== sha256(canonicalJson(task.verifier))
		)
			throw new Error(`${task.id}: verifierSha256 does not match the verifier.`);
		if (!task.nativeTestCommand?.trim())
			throw new Error(`${task.id}: nativeTestCommand is required.`);
		if (
			!Number.isInteger(task.warmTestTimeoutMs) ||
			task.warmTestTimeoutMs < 1 ||
			task.warmTestTimeoutMs > 300_000
		)
			throw new Error(`${task.id}: warmTestTimeoutMs must be between 1 and 300000.`);
		if (!Array.isArray(task.requirements))
			throw new Error(`${task.id}: requirements are required.`);
		for (const requirement of task.requirements)
			if (FORBIDDEN_REQUIREMENT.test(requirement))
				throw new Error(`${task.id}: forbidden requirement ${requirement}.`);
	}

	if (repositories.size !== 6)
		throw new Error("Qualification corpus must use exactly 6 repositories.");
	const tierCounts = Object.fromEntries(
		["core", "recovery", "trivial", "adoption"].map((tier) => [
			tier,
			corpus.tasks.filter((task) => task.tier === tier).length,
		]),
	);
	if (
		tierCounts.core !== 8 ||
		tierCounts.recovery !== 2 ||
		tierCounts.trivial !== 1 ||
		tierCounts.adoption !== 1
	)
		throw new Error(
			"Qualification tiers must contain 8 core, 2 recovery, 1 trivial, and 1 adoption task.",
		);

	return corpus;
}

export function sealQualificationCorpus(value: unknown): QualificationCorpus {
	if (!(isRecord(value) && Array.isArray(value.tasks)))
		throw new Error("Qualification corpus must contain tasks before sealing.");
	const sealed = structuredClone(value) as Record<string, unknown> & {
		tasks: Array<Record<string, unknown>>;
	};
	sealed.status = "sealed";
	for (const task of sealed.tasks) {
		task.promptSha256 = sha256(String(task.prompt ?? ""));
		task.verifierSha256 = sha256(canonicalJson(task.verifier));
	}
	return parseQualificationCorpus(sealed);
}

export function sha256(value: string) {
	return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: The verifier union is validated fail-closed in one boundary function.
function validateVerifier(id: string, verifier: QualificationVerifier) {
	if (!isRecord(verifier)) throw new Error(`${id}: verifier must be an object.`);
	if (
		!(["judge", "historical-patch", "exact-edit", "recovery", "adoption"] as unknown[]).includes(
			verifier.kind,
		)
	)
		throw new Error(`${id}: invalid verifier kind.`);
	if (!Array.isArray(verifier.requirements) || verifier.requirements.length === 0)
		throw new Error(`${id}: verifier requirements are required.`);
	if (!Array.isArray(verifier.expectedPaths) || verifier.expectedPaths.length === 0)
		throw new Error(`${id}: verifier expectedPaths are required.`);
	if (verifier.kind === "historical-patch" && !COMMIT.test(verifier.referenceCommit ?? ""))
		throw new Error(`${id}: historical verifier requires an immutable referenceCommit.`);
	if (
		verifier.kind === "historical-patch" &&
		(!Array.isArray(verifier.verificationPaths) || verifier.verificationPaths.length === 0)
	)
		throw new Error(`${id}: historical verifier requires independent verificationPaths.`);
	for (const check of verifier.contentChecks ?? []) {
		if (!(check.path && Array.isArray(check.includes)) || check.includes.length === 0)
			throw new Error(`${id}: deterministic content checks require a path and included text.`);
		if (check.excludes !== undefined && !Array.isArray(check.excludes))
			throw new Error(`${id}: deterministic excluded content must be an array.`);
	}
	for (const check of verifier.changedFileContentChecks ?? [])
		if (!(check.prefix && Array.isArray(check.includes) && check.includes.length > 0))
			throw new Error(`${id}: changed-file checks require a prefix and included text.`);
	if (verifier.requiredChangedPaths && !Array.isArray(verifier.requiredChangedPaths))
		throw new Error(`${id}: requiredChangedPaths must be an array.`);
	if (verifier.unchangedRustCodePaths && !Array.isArray(verifier.unchangedRustCodePaths))
		throw new Error(`${id}: unchangedRustCodePaths must be an array.`);
	if (verifier.kind === "recovery") {
		const evidence = verifier.recoveryEvidence;
		if (!evidence?.traceChecks.length)
			throw new Error(`${id}: recovery verifier requires transcript evidence.`);
		if (evidence.traceChecks.some((check) => !check.needle || check.minimumOccurrences < 1))
			throw new Error(`${id}: recovery transcript checks require a needle and positive count.`);
		if (evidence.signal === "truncated-read" && !evidence.fixture)
			throw new Error(`${id}: truncated recovery requires a frozen excerpt fixture.`);
		if (evidence.fixture && !(evidence.fixture.path && evidence.fixture.content.trim()))
			throw new Error(`${id}: recovery fixture path and content are required.`);
	}
}

function canonicalJson(value: unknown): string {
	if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
	if (isRecord(value))
		return `{${Object.keys(value)
			.sort()
			.map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
			.join(",")}}`;
	return JSON.stringify(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
