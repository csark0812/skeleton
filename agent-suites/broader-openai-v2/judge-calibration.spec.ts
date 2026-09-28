import { describe, expect } from "@post-print/agent-test";
import { reviewInstructions, reviewSchema } from "../../scripts/efficacy/judge.ts";

const calibration = describe("Public qualification judge calibration", ({ judge }) => ({
	reviewer: judge({
		prompt: `${reviewInstructions}
The answer must identify src/owner.ts, tests/owner.test.ts, and docs/owner.md as the three owning paths. It must state that src/owner.ts defines the behavior, tests/owner.test.ts verifies it, and docs/owner.md documents it. Do not accept a completion claim without transcript evidence.`,
		schema: reviewSchema,
	}),
}));

calibration("accepts a fully evidenced read-only answer", async ({ reviewer }) => {
	const verdict = await reviewer.run({
		input: {
			prompt: "Locate the implementation, test, and documentation owners.",
			messages: [
				{
					role: "assistant",
					content:
						"src/owner.ts defines the behavior, tests/owner.test.ts verifies it, and docs/owner.md documents it.",
				},
			],
			toolCalls: [
				{
					name: "read",
					result:
						"src/owner.ts: exported owner behavior\ntests/owner.test.ts: focused regression\ndocs/owner.md: canonical contract",
					succeeded: true,
				},
			],
		},
	});
	expect(verdict.output.correct, verdict.output.reason).toBe(true);
});

calibration("rejects an unsupported read-only completion claim", async ({ reviewer }) => {
	const verdict = await reviewer.run({
		input: {
			prompt: "Locate the implementation, test, and documentation owners.",
			messages: [{ role: "assistant", content: "Done. I found and verified all three owners." }],
			toolCalls: [],
		},
	});
	expect(verdict.output.correct, verdict.output.reason).toBe(false);
});
