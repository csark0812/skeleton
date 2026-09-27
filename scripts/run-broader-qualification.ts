import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { parseQualificationCorpus, sha256 } from "./efficacy/corpus.ts";
import { qualificationCellEvidence } from "./efficacy/evidence.ts";
import { interventionDigest } from "./efficacy/intervention.ts";
import { preparePublicQualification } from "./efficacy/public-workspaces.ts";
import { evaluateQualification, type QualificationCell } from "./efficacy/qualification.ts";
import { reserveQualificationRun } from "./efficacy/run-lock.ts";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const CORPUS_PATH = join(ROOT, "agent-suites/broader-openai-v1/qualification-corpus.json");
const args = new Set(process.argv.slice(2));
const allowed = new Set(["--prepare-only", "--skip-dependency-install"]);
for (const arg of args) if (!allowed.has(arg)) throw new Error(`Unknown option: ${arg}`);
if (args.has("--skip-dependency-install") && !args.has("--prepare-only"))
	throw new Error("--skip-dependency-install is allowed only with --prepare-only.");

const dirty = command("git", ["status", "--porcelain"], ROOT).trim();
if (dirty) throw new Error("Qualification requires a clean release-candidate worktree.");
const corpusBytes = readFileSync(CORPUS_PATH);
const corpus = parseQualificationCorpus(JSON.parse(corpusBytes.toString("utf8")));
const head = command("git", ["rev-parse", "HEAD"], ROOT).trim();
const intervention = interventionDigest(ROOT);
const lock = {
	version: corpus.version,
	createdAt: new Date().toISOString(),
	gitCommit: head,
	corpusSha256: sha256(corpusBytes.toString("utf8")),
	intervention,
	model: corpus.model,
	judgeModel: corpus.judgeModel,
	repetitions: corpus.repetitions,
};
const lockRoot = join(ROOT, ".qualification-cache");
mkdirSync(lockRoot, { recursive: true });
writeFileSync(join(lockRoot, "qualification-lock.json"), `${JSON.stringify(lock, null, 2)}\n`);

const prepared = preparePublicQualification(ROOT, corpus, {
	installDependencies: !args.has("--skip-dependency-install"),
});
writeFileSync(join(lockRoot, "prepared-workspaces.json"), `${JSON.stringify(prepared, null, 2)}\n`);
if (args.has("--prepare-only")) {
	console.log(`Prepared ${prepared.prepared.length} sealed public qualification workspaces.`);
	process.exit(0);
}

const resultRoot = join(lockRoot, "results");
const evidencePath = join(ROOT, "docs/evidence/efficacy/broader-openai-v1.json");
reserveQualificationRun(resultRoot, evidencePath);
assertFrozenInputs();
const agentTest = fileURLToPath(new URL("../node_modules/.bin/agent-test", import.meta.url));
const calibration = spawnSync(
	agentTest,
	["test", "broader-openai-v1/judge-calibration.spec.ts", "--config=agent-test.broader.config.ts"],
	{ cwd: ROOT, stdio: "inherit", env: { ...process.env } },
);
const execution = calibration.status === 0 ? spawnQualification(agentTest) : null;

function spawnQualification(executable: string) {
	assertFrozenInputs();
	return spawnSync(
		executable,
		["test", "broader-openai-v1/qualification.spec.ts", "--config=agent-test.broader.config.ts"],
		{
			cwd: ROOT,
			stdio: "inherit",
			env: { ...process.env, SKELETON_EFFICACY_RUNS: String(corpus.repetitions) },
		},
	);
}

const cells: QualificationCell[] = [];
const cellResults: Array<{ id: string; pairs: QualificationCell["pairs"] }> = [];
const missing: string[] = [];
for (const task of corpus.tasks) {
	const path = join(resultRoot, `${task.id}.json`);
	if (!existsSync(path)) {
		missing.push(task.id);
		continue;
	}
	const result = JSON.parse(readFileSync(path, "utf8"));
	cells.push({ id: task.id, repository: task.repository, tier: task.tier, pairs: result.pairs });
	cellResults.push({ id: task.id, pairs: result.pairs });
}
const report = evaluateQualification(cells, {
	bootstrapSamples: corpus.bootstrap.samples,
	seed: corpus.bootstrap.seed,
});
const infrastructureErrors = cells.some((cell) =>
	cell.pairs.some((pair) =>
		[pair.baseline, pair.withSkeleton].some(
			(outcome) => outcome.status === "execution-error" || outcome.status === "evaluation-error",
		),
	),
);
const evidence = {
	status:
		calibration.status !== 0 || execution?.status !== 0 || missing.length || infrastructureErrors
			? "inconclusive"
			: report.passed
				? "passed"
				: "failed",
	generatedAt: new Date().toISOString(),
	lock,
	artifact: prepared.artifact,
	missingCells: missing,
	publicCells: qualificationCellEvidence(corpus, cellResults),
	calibrationExitCode: calibration.status,
	agentTestExitCode: execution?.status ?? null,
	report,
};
const evidenceRoot = join(ROOT, "docs/evidence/efficacy");
mkdirSync(evidenceRoot, { recursive: true });
writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
console.log(`Qualification evidence: ${evidencePath}`);
if (calibration.error) throw calibration.error;
if (execution?.error) throw execution.error;
process.exitCode =
	calibration.status === 0 && execution?.status === 0 && !missing.length && report.passed ? 0 : 1;

function command(executable: string, commandArgs: string[], cwd: string) {
	const result = spawnSync(executable, commandArgs, { cwd, encoding: "utf8" });
	if (result.error) throw result.error;
	if (result.status !== 0)
		throw new Error(result.stderr || `${executable} exited ${result.status}`);
	return result.stdout;
}

function assertFrozenInputs() {
	const currentCorpus = readFileSync(CORPUS_PATH, "utf8");
	const current = {
		gitCommit: command("git", ["rev-parse", "HEAD"], ROOT).trim(),
		corpusSha256: sha256(currentCorpus),
		intervention: interventionDigest(ROOT),
	};
	if (
		current.gitCommit !== lock.gitCommit ||
		current.corpusSha256 !== lock.corpusSha256 ||
		JSON.stringify(current.intervention) !== JSON.stringify(lock.intervention)
	)
		throw new Error("Frozen qualification inputs changed after preparation; refusing agent spend.");
}
