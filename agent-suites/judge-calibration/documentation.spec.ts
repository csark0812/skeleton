import { describe, expect } from "@post-print/agent-test";
import { documentationInstructions } from "../../scripts/efficacy/documents.ts";
import { reviewSchema } from "../../scripts/efficacy/judge.ts";

const test = describe("Documentation judge calibration", ({ judge }) => ({
	documentation: judge({
		prompt: `${documentationInstructions}\nReturn correct only when the final document states that the billing endpoint is https://api.example.com/v2/billing/webhook and failed deliveries are retried once. This calibration assesses documentation only, not agent verification.`,
		schema: reviewSchema,
	}),
}));

test("rejects stale final text despite a successful completion claim", async ({
	documentation,
}) => {
	const stale =
		"The billing endpoint is https://api.example.com/v1/billing/webhook. Failed deliveries are not retried.";
	const review = await documentation.run({
		input: {
			document: { path: "docs/billing.md", before: stale, after: stale, diff: "" },
			transcript: {
				prompt: "Update the docs.",
				messages: [
					{
						role: "assistant",
						content: "I updated the docs to v2 and one retry. Everything is correct.",
					},
				],
				toolCalls: [],
			},
		},
	});
	expect(review.output.correct, review.output.reason).toBe(false);
});

test("accepts correct final text without requiring a transcript reread", async ({
	documentation,
}) => {
	const review = await documentation.run({
		input: {
			document: {
				path: "docs/billing.md",
				before: "The endpoint is v1. No retries.",
				after:
					"The billing endpoint is https://api.example.com/v2/billing/webhook. Failed deliveries are retried once.",
				diff: "-The endpoint is v1. No retries.\n+The billing endpoint is https://api.example.com/v2/billing/webhook. Failed deliveries are retried once.",
			},
			transcript: { prompt: "Update the docs.", messages: [], toolCalls: [] },
		},
	});
	expect(review.output.correct, review.output.reason).toBe(true);
});
