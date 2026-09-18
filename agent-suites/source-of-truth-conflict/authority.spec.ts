import type { JsonValue } from "@post-print/agent-test";
import { describe, expect } from "@post-print/agent-test";
import { reviewInstructions, reviewSchema, transcript } from "../../scripts/efficacy/judge.ts";

function boundedTranscript(run: Parameters<typeof transcript>[0]): JsonValue {
	const trim = (item: JsonValue): JsonValue => {
		if (typeof item === "string" && item.length > 12_000) {
			return `${item.slice(0, 6_000)}\n[truncated]\n${item.slice(-6_000)}`;
		}
		if (Array.isArray(item)) return item.map(trim);
		if (item && typeof item === "object" && !Array.isArray(item)) {
			return Object.fromEntries(Object.entries(item).map(([key, value]) => [key, trim(value)])) as {
				[key: string]: JsonValue;
			};
		}
		return item;
	};
	return trim(transcript(run));
}

const prompt =
	"Two Billing webhook documents disagree. Determine whether the repository identifies one as authoritative. If it does, give the URL new integrations should use. Cite every document you used.";
const test = describe("Document authority", ({ agent, judge }) => ({
	unmarked: agent({ workspace: "tests/fixtures/efficacy/conflict/unmarked" }),
	marked: agent({ workspace: "tests/fixtures/efficacy/conflict/single-marker" }),
	duplicate: agent({ workspace: "tests/fixtures/efficacy/conflict/duplicate-markers" }),
	matchedAnswers: judge({
		prompt: `${reviewInstructions}
Both agents must use evidence from both disagreeing documents and cite them. Context-command excerpts count as inspection.
The unmarked transcript must report unresolved authority and withhold a recommendation.
The marked transcript must identify reference A as the sole authoritative document and recommend https://api.example.com/v2/billing/webhook.
The pair must show that the marker changes an unresolved answer into one justified recommendation.`,
		schema: reviewSchema,
	}),
	duplicateAnswer: judge({
		prompt: `${reviewInstructions}
	The agent must use evidence from both disagreeing documents and cite them. Context-command excerpts count as inspection.
	It must clearly establish that both documents claim the same authority (explicitly or by showing equal authority metadata with no sole marker), and refuse to choose a document or recommend a URL.`,
		schema: reviewSchema,
	}),
}));

test("uses one authority marker to resolve conflicting documents", async ({
	unmarked,
	marked,
	matchedAnswers,
}) => {
	const [withoutMarker, withMarker] = await Promise.all([
		unmarked.run({ prompt }),
		marked.run({ prompt }),
	]);
	for (const run of [withoutMarker, withMarker]) {
		expect(run).not.toHaveCalledTool(/^(Write|Edit|apply_patch)$/);
		expect(run.workspace.changedPaths).toEqual([]);
	}
	expect(withMarker.output).toContain("docs/billing-webhook-a.md");
	expect(withMarker.output).toContain("https://api.example.com/v2/billing/webhook");
	const review = await matchedAnswers.run({
		input: { unmarked: boundedTranscript(withoutMarker), marked: boundedTranscript(withMarker) },
	});
	expect(review.output.correct, review.output.reason).toBe(true);
});

test("refuses to choose when both documents claim authority", async ({
	duplicate,
	duplicateAnswer,
}) => {
	const run = await duplicate.run({ prompt });
	expect(run).not.toHaveCalledTool(/^(Write|Edit|apply_patch)$/);
	expect(run.workspace.changedPaths).toEqual([]);
	const review = await duplicateAnswer.run({ input: boundedTranscript(run) });
	expect(review.output.correct, review.output.reason).toBe(true);
});
