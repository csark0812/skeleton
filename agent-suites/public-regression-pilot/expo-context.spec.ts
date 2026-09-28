import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect } from "@post-print/agent-test";
import { parseQualificationCorpus } from "../../scripts/efficacy/corpus.ts";
import { reviewInstructions, reviewSchema, transcript } from "../../scripts/efficacy/judge.ts";
import {
	assertPilotSandboxReady,
	hasSuccessfulLocalShell,
	pilotHasLocalAccess,
} from "../../scripts/efficacy/pilot-access.ts";
import { expoPilotV2Paths } from "../../scripts/efficacy/pilot-paths.ts";

const root = fileURLToPath(new URL("../..", import.meta.url));
const corpus = parseQualificationCorpus(
	JSON.parse(
		readFileSync(join(root, "agent-suites/broader-openai-v1/qualification-corpus.json"), "utf8"),
	),
);
const task = corpus.tasks.find((entry) => entry.id === "expo-metro-ownership");
if (!task) throw new Error("Retired Expo regression task is missing.");
const paths = expoPilotV2Paths(root);

const pilot = describe("Public regression pilot: Expo discovery", ({ agent, judge }) => ({
	baseline: agent({ workspace: relative(root, paths.control) }),
	withSkeleton: agent({ workspace: relative(root, paths.treatment) }),
	reviewer: judge({
		prompt: `${reviewInstructions}\nThe public task has these requirements:\n${task.verifier.requirements.map((requirement) => `- ${requirement}`).join("\n")}\nUse only the supplied transcript. Do not infer correctness from a completion claim.`,
		schema: reviewSchema,
	}),
}));

pilot("one paired attempt, no retry", async ({ baseline, withSkeleton, reviewer }) => {
	const output = paths.result;
	if (existsSync(output))
		throw new Error("This capped pilot already ran; do not spend on a repeat.");
	assertPilotSandboxReady();
	const candidateHash = createHash("sha256")
		.update(readFileSync(join(root, "dist/cli.js")))
		.digest("hex");
	const installedHash = createHash("sha256")
		.update(readFileSync(join(paths.treatment, "node_modules/@csark0812/skeleton/dist/cli.js")))
		.digest("hex");
	if (candidateHash !== installedHash)
		throw new Error("Pilot treatment does not contain the current built Skeleton CLI.");
	const [without, treatment] = await Promise.all([
		baseline.run({ prompt: task.prompt }),
		withSkeleton.run({ prompt: task.prompt }),
	]);
	const accessEvidence = {
		baselineToolCalls: without.trace.toolCalls.length,
		treatmentToolCalls: treatment.trace.toolCalls.length,
		baselineShellSucceeded: hasSuccessfulLocalShell(without.trace.toolCalls),
		treatmentShellSucceeded: hasSuccessfulLocalShell(treatment.trace.toolCalls),
	};
	if (!pilotHasLocalAccess(accessEvidence)) {
		mkdirSync(join(root, ".qualification-cache/pilot-results"), { recursive: true });
		writeFileSync(
			output,
			`${JSON.stringify(
				{
					kind: "development-regression-pilot",
					status: "inconclusive-tool-access",
					qualificationEligible: false,
					corpusTask: task.id,
					baseline: { runId: without.id, tokens: without.usage.tokens.total },
					withSkeleton: { runId: treatment.id, tokens: treatment.usage.tokens.total },
					accessEvidence,
				},
				null,
				2,
			)}\n`,
		);
		throw new Error("Both pilot agents need successful local shell access; judges were not run.");
	}
	const [withoutReview, treatmentReview] = await Promise.all([
		reviewer.run({ input: transcript(without) }),
		reviewer.run({ input: transcript(treatment) }),
	]);
	const result = {
		kind: "development-regression-pilot",
		qualificationEligible: false,
		corpusTask: task.id,
		baseline: {
			runId: without.id,
			correct: withoutReview.output.correct && without.workspace.changedPaths.length === 0,
			tokens: without.usage.tokens.total,
			judgeRunId: withoutReview.id,
			judgeTokens: withoutReview.usage.tokens.total,
			reason: withoutReview.output.reason,
		},
		withSkeleton: {
			runId: treatment.id,
			correct: treatmentReview.output.correct && treatment.workspace.changedPaths.length === 0,
			tokens: treatment.usage.tokens.total,
			judgeRunId: treatmentReview.id,
			judgeTokens: treatmentReview.usage.tokens.total,
			reason: treatmentReview.output.reason,
		},
	};
	mkdirSync(join(root, ".qualification-cache/pilot-results"), { recursive: true });
	writeFileSync(output, `${JSON.stringify(result, null, 2)}\n`);
	expect(without.workspace.changedPaths).toEqual([]);
	expect(treatment.workspace.changedPaths).toEqual([]);
	expect(withoutReview.output.correct, withoutReview.output.reason).toBe(true);
	expect(treatmentReview.output.correct, treatmentReview.output.reason).toBe(true);
});
