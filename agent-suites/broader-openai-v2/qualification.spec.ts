import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import type { Run } from "@post-print/agent-test";
import { describe, expect } from "@post-print/agent-test";
import {
	ADOPTION_INSTALL_DIR,
	adoptionInstalledCli,
	inspectAdoptionSetup,
} from "../../scripts/efficacy/adoption.ts";
import {
	parseQualificationCorpus,
	type QualificationCorpusTask,
} from "../../scripts/efficacy/corpus.ts";
import { reviewInstructions, reviewSchema, transcript } from "../../scripts/efficacy/judge.ts";
import { type Pair, summarizeReliability } from "../../scripts/efficacy/measurements.ts";
import {
	verifyExactEdit,
	verifyHistoricalTask,
	verifyNativeTask,
} from "../../scripts/efficacy/public-verification.ts";
import {
	publicAgentWorkspacePaths,
	publicRepositoryCache,
	publicWorkspacePaths,
	qualificationRuntimeEnv,
} from "../../scripts/efficacy/public-workspaces.ts";
import {
	assessWithEvaluationRetry,
	runWithInfrastructureRetry,
} from "../../scripts/efficacy/retries.ts";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const corpus = parseQualificationCorpus(
	JSON.parse(readFileSync(new URL("./qualification-corpus.json", import.meta.url), "utf8")),
);
if (process.env.SKELETON_EFFICACY_RUNS !== String(corpus.repetitions))
	throw new Error(`Qualification requires SKELETON_EFFICACY_RUNS=${corpus.repetitions}.`);

for (const task of corpus.tasks) defineTask(task);

function defineTask(task: QualificationCorpusTask) {
	const paths = publicAgentWorkspacePaths(ROOT, task);
	if (!(existsSync(paths.control) && existsSync(paths.treatment)))
		throw new Error(`${task.id}: run public qualification preparation before test discovery.`);
	const qualification = describe("Public polyglot OpenAI qualification", ({ agent, judge }) => ({
		baseline: agent({ workspace: relative(ROOT, paths.control) }),
		withSkeleton: agent({ workspace: relative(ROOT, paths.treatment) }),
		reviewer: judge({
			prompt: `${reviewInstructions}\nThe public task has these requirements:\n${task.verifier.requirements
				.map((requirement) => `- ${requirement}`)
				.join(
					"\n",
				)}\nUse only the supplied transcript. Do not infer correctness from a completion claim.`,
			schema: reviewSchema,
		}),
	}));

	qualification(task.id, async ({ baseline, withSkeleton, reviewer }, info) => {
		Object.assign(process.env, qualificationRuntimeEnv(ROOT, task, corpus.version), {
			CARGO_NET_OFFLINE: "true",
			UV_OFFLINE: "1",
		});
		const pairs: Pair[] = [];
		for (let index = 0; index < corpus.repetitions; index++) {
			const [left, right] = await Promise.all([
				runWithInfrastructureRetry(() => baseline.run({ prompt: task.prompt })),
				runWithInfrastructureRetry(() => runTreatment(task, withSkeleton)),
			]);
			const [without, treatment] = await Promise.all([
				assessWithEvaluationRetry(left, (run) => evaluateRun(task, run, reviewer, false, info)),
				assessWithEvaluationRetry(right, (run) => evaluateRun(task, run, reviewer, true, info)),
			]);
			if (right.status === "fulfilled" && task.tier === "adoption") {
				const measured = right.value as Run & {
					setupTokens?: number;
					maintenanceTokens?: number;
					setupVerified?: boolean;
				};
				Object.assign(treatment, {
					setupTokens: measured.setupTokens,
					maintenanceTokens: measured.maintenanceTokens,
					setupVerified: measured.setupVerified,
				});
			}
			pairs.push({ baseline: without, withSkeleton: treatment });
			await info.attach(`pair-${index + 1}`, {
				body: JSON.stringify(pairs.at(-1)),
				contentType: "application/json",
			});
		}
		const report = summarizeReliability(pairs);
		await info.attach("cell-report", {
			body: JSON.stringify(report, null, 2),
			contentType: "application/json",
		});
		const resultRoot = join(ROOT, ".qualification-cache", "results-v2");
		mkdirSync(resultRoot, { recursive: true });
		writeFileSync(join(resultRoot, `${task.id}.json`), JSON.stringify({ task, pairs }, null, 2));
		expect(report.attempts, "The sealed cell records all ten paired attempts").toBe(10);
	});
}

async function evaluateRun(
	task: QualificationCorpusTask,
	run: Run,
	reviewer: {
		run(options: { input: unknown }): Promise<{
			id: string;
			usage: { tokens: { total?: number } };
			output: { correct: boolean; reason: string };
		}>;
	},
	treatment: boolean,
	info: { attach(name: string, options: { body: string; contentType: string }): Promise<void> },
) {
	const checks: Record<string, boolean> = {};
	const reasons: string[] = [];
	let judgeDiagnostics: { judgeRunId: string; judgeTokens?: number } | undefined;
	const preparedPaths = publicWorkspacePaths(ROOT, task);
	const dependencyWorkspace = treatment ? preparedPaths.treatment : preparedPaths.control;
	const verificationEnv = {
		...qualificationRuntimeEnv(ROOT, task, corpus.version),
		CARGO_NET_OFFLINE: "true",
		UV_OFFLINE: "1",
	};
	if (task.kind === "discovery") {
		const review = await reviewer.run({ input: transcript(run) });
		checks.review = review.output.correct;
		reasons.push(review.output.reason);
		judgeDiagnostics = { judgeRunId: review.id, judgeTokens: review.usage.tokens.total };
		checks.unchanged = run.workspace.changedPaths.length === 0;
		reasons.push(
			checks.unchanged
				? "No files changed."
				: `Changed files: ${run.workspace.changedPaths.join(", ")}`,
		);
	} else if (task.verifier.kind === "historical-patch") {
		const verification = verifyHistoricalTask(
			task,
			run.workspace.final.path,
			publicRepositoryCache(ROOT, task),
			{ env: verificationEnv, dependencyWorkspace },
		);
		if (verification.error) throw new Error(verification.error);
		checks.independentRegression = verification.passed;
		reasons.push(verification.error ?? verification.output);
		await info.attach(`${run.id}-independent-regression`, {
			body: verification.error ?? verification.output,
			contentType: "text/plain",
		});
	} else if (task.verifier.kind === "exact-edit") {
		const exact = verifyExactEdit(task, {
			initial: run.workspace.initial.path,
			final: run.workspace.final.path,
			changedPaths: run.workspace.changedPaths,
		});
		if (exact.error) throw new Error(exact.error);
		checks.exactReplacement = exact.passed;
		reasons.push(exact.output);
	} else {
		const verification = verifyNativeTask(task, run.workspace.final.path, {
			env: verificationEnv,
			dependencyWorkspace,
		});
		if (verification.error) throw new Error(verification.error);
		checks.nativeVerification = verification.passed;
		reasons.push(verification.error ?? verification.output);
	}
	if (task.verifier.kind === "recovery" && treatment) {
		const evidence = JSON.stringify(transcript(run));
		const recovery = task.verifier.recoveryEvidence!;
		checks.recoveryObserved = recovery.traceChecks.every(
			(check) => countOccurrences(evidence, check.needle) >= check.minimumOccurrences,
		);
	}
	if (task.verifier.kind === "adoption" && treatment) {
		checks.installed = existsSync(
			join(
				run.workspace.root,
				ADOPTION_INSTALL_DIR,
				"node_modules/@csark0812/skeleton/package.json",
			),
		);
		checks.configured = existsSync(join(run.workspace.final.path, "skeleton.toml"));
		checks.exactArtifact = installedArtifactMatchesVendor(run.workspace.root);
		checks.setupVerified = (run as Run & { setupVerified?: boolean }).setupVerified === true;
	}
	for (const path of task.verifier.requiredChangedPaths ?? [])
		checks[`changed:${path}`] = run.workspace.changedPaths.includes(path);
	for (const path of task.verifier.unchangedRustCodePaths ?? []) {
		const beforePath = join(run.workspace.initial.path, path);
		const afterPath = join(run.workspace.final.path, path);
		checks[`behavior-unchanged:${path}`] =
			existsSync(beforePath) &&
			existsSync(afterPath) &&
			stripRustDocumentation(readFileSync(beforePath, "utf8")) ===
				stripRustDocumentation(readFileSync(afterPath, "utf8"));
	}
	for (const content of task.verifier.contentChecks ?? []) {
		const path = join(run.workspace.final.path, content.path);
		const value = existsSync(path) ? readFileSync(path, "utf8") : "";
		checks[`content:${content.path}:included`] = content.includes.every((text) =>
			value.includes(text),
		);
		checks[`content:${content.path}:excluded`] =
			existsSync(path) && (content.excludes ?? []).every((text) => !value.includes(text));
	}
	for (const content of task.verifier.changedFileContentChecks ?? []) {
		const changed = run.workspace.changedPaths.filter((path) => path.startsWith(content.prefix));
		checks[`changed-content:${content.prefix}`] = changed.some((path) => {
			const finalPath = join(run.workspace.final.path, path);
			return (
				existsSync(finalPath) &&
				content.includes.every((text) => readFileSync(finalPath, "utf8").includes(text))
			);
		});
	}
	return {
		checks,
		reason: reasons.join("\n"),
		...(judgeDiagnostics ? { diagnostics: judgeDiagnostics } : {}),
	};
}

function installedArtifactMatchesVendor(root: string) {
	const installed = adoptionInstalledCli(root, ADOPTION_INSTALL_DIR);
	const tarball = join(root, "vendor/skeleton.tgz");
	if (!(existsSync(installed) && existsSync(tarball))) return false;
	const packed = execFileSync("tar", ["-xOf", tarball, "package/dist/cli.js"]);
	return digest(readFileSync(installed)) === digest(packed);
}

function digest(value: Buffer) {
	return createHash("sha256").update(value).digest("hex");
}

function countOccurrences(value: string, needle: string) {
	return value.split(needle).length - 1;
}

function stripRustDocumentation(source: string) {
	return source.replace(/^\s*\/\/[/!] .*\n/gm, "");
}

async function runTreatment(
	task: QualificationCorpusTask,
	agent: { run(options: { prompt: string }): Promise<Run> },
) {
	if (task.tier !== "adoption") return agent.run({ prompt: task.prompt });
	const setup = await agent.run({
		prompt: `Biome's root has workspace: dependencies, so do not run npm install at the repository root. Install the exact local artifact offline with \`npm install --prefix ${ADOPTION_INSTALL_DIR} --offline --ignore-scripts --no-save ./vendor/skeleton.tgz\`. Run its CLI at \`${ADOPTION_INSTALL_DIR}/node_modules/@csark0812/skeleton/dist/cli.js\` to initialize without optional skills. Create docs/qualification/${task.id}.md as the owner for ${task.verifier.expectedPaths.join(", ")}; add valid ownership and review-dependency metadata, refresh the catalog, record review proof, and verify that Skeleton context resolves the first listed path to this owner. Preserve source behavior and do not implement the maintenance request yet.`,
	});
	const setupVerified = inspectAdoptionSetup(
		setup.workspace.root,
		task,
		ADOPTION_INSTALL_DIR,
	).passed;
	const maintenance = await setup.continue({ prompt: task.prompt });
	return Object.assign(maintenance, {
		setupTokens: setup.usage.tokens.total,
		maintenanceTokens: maintenance.usage.tokens.total,
		setupVerified,
		usage: {
			tokens: {
				total:
					setup.usage.tokens.total === undefined || maintenance.usage.tokens.total === undefined
						? undefined
						: setup.usage.tokens.total + maintenance.usage.tokens.total,
			},
		},
		durationMs: setup.durationMs + maintenance.durationMs,
	});
}
