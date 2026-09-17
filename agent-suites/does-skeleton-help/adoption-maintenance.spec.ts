import { openai } from "@post-print/agent-harness";
import type { Run } from "@post-print/agent-test";
import { describe, expect } from "@post-print/agent-test";
import { adoptionChecks, sequenceTokens } from "../../scripts/efficacy/adoption.ts";
import {
	documentationEvidence,
	documentationInstructions,
} from "../../scripts/efficacy/documents.ts";
import { codeReviewSchema, reviewInstructions, transcript } from "../../scripts/efficacy/judge.ts";
import { assessRun, measureReliability } from "../../scripts/efficacy/measurements.ts";
import { checkOrderLimits } from "../../scripts/efficacy/order-checks.ts";

const prompt =
	"Increase the standard order limit from 20 to 30. Preserve special-category and fallback limits. Keep documentation and any existing review metadata current. Verify the change.";
const test = describe("Skeleton adoption and the first maintenance change", ({ agent, judge }) => ({
	baseline: agent({ workspace: "tests/fixtures/efficacy/tradeoffs/adoption/control" }),
	adopter: agent({
		agent: openai({ model: "gpt-5.6-luna", networkAccess: true }),
		workspace: "tests/fixtures/efficacy/tradeoffs/adoption/skeleton",
	}),
	documentationAndVerification: judge({
		prompt: `${reviewInstructions}\n${documentationInstructions}\nSet documentationCorrect when final docs describe standard=30, regulated=5 and fallback=20 accurately. Set verificationAdequate when the agent ran successful meaningful tests for these cases.`,
		schema: codeReviewSchema,
	}),
}));

test("records installation, metadata setup, and maintenance cost separately", async ({
	baseline,
	adopter,
	documentationAndVerification,
}, info) => {
	const evaluate = async (run: Run) => {
		const regression = checkOrderLimits(run);
		await info.attach(`${run.id}-regression`, {
			body: regression.output,
			contentType: "text/plain",
		});
		const review = await documentationAndVerification.run({
			input: {
				transcript: transcript(run),
				document: documentationEvidence(run, "docs/orders.md"),
			},
		});
		return {
			checks: {
				regression: regression.passed,
				documentation: review.output.documentationCorrect,
				verification: review.output.verificationAdequate,
			},
			reason: `${regression.output}\n${review.output.reason}`,
		};
	};
	const report = await measureReliability(info, async () => {
		const [left, right] = await Promise.allSettled([
			baseline.run({ prompt }),
			(async () => {
				const setup = await adopter.run({
					prompt:
						"Install the local package vendor/skeleton.tgz with npm and initialize Skeleton without optional skills. Configure ownership and dependency metadata for the existing order policy and record its review proof. Preserve application behavior. Verify the setup.",
				});
				const setupChecks = {
					...adoptionChecks(setup),
					sourceUnchanged: !setup.workspace.changedPaths.some((path) => path.startsWith("src/")),
				};
				await info.attach(`${setup.id}-adoption`, {
					body: JSON.stringify({
						tokens: setup.usage.tokens.total,
						durationMs: setup.durationMs,
						checks: setupChecks,
					}),
					contentType: "application/json",
				});
				const maintenance = await setup.continue({ prompt });
				await info.attach(`${maintenance.id}-maintenance`, {
					body: JSON.stringify({
						tokens: maintenance.usage.tokens.total,
						durationMs: maintenance.durationMs,
					}),
					contentType: "application/json",
				});
				return {
					...maintenance,
					setupChecks,
					usage: { tokens: { total: sequenceTokens([setup, maintenance]) } },
					durationMs: setup.durationMs + maintenance.durationMs,
				};
			})(),
		]);
		const without = await assessRun(left, evaluate);
		const withTool = await assessRun(right, async (run) => {
			const assessment = await evaluate(run);
			return {
				...assessment,
				checks: {
					...assessment.checks,
					...adoptionChecks(run),
					setup: Object.values(run.setupChecks).every(Boolean),
				},
			};
		});
		return { baseline: without, withSkeleton: withTool };
	});
	const details = JSON.stringify(report);
	expect(report.baseline.correct, details).toBe(report.attempts);
	expect(report.withSkeleton.correct, details).toBe(report.attempts);
	expect(report.efficiency.pairs, details).toBe(report.attempts);
	// Total treatment tokens include adoption. No amortized savings claim from one change.
});
