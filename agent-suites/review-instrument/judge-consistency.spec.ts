import { readFileSync } from "node:fs";
import { describe, expect } from "@post-print/agent-test";
import {
	detectionInstructions,
	detectionSchema,
	judgeReport,
} from "../../scripts/efficacy/review-detection.ts";
import { REVIEW_SCENARIOS } from "../../scripts/efficacy/review-scenarios.ts";

const JUDGMENTS_PER_REPORT = 3;
const CONCURRENT_JUDGMENTS = 5;
const reports: { id: string; report: string }[] = JSON.parse(
	readFileSync(new URL("../seeds/review-judge-reports.json", import.meta.url), "utf8"),
);

const test = describe("Review instrument", ({ judge }) => ({
	detection: judge({
		prompt: detectionInstructions(REVIEW_SCENARIOS.payments),
		schema: detectionSchema(REVIEW_SCENARIOS.payments),
	}),
}));

test("Judge repeats its verdicts on stored review reports", async ({ detection }) => {
	const requests = reports.flatMap(({ report }) =>
		Array.from({ length: JUDGMENTS_PER_REPORT }, () => report),
	);
	let failures = 0;
	for (let start = 0; start < requests.length; start += CONCURRENT_JUDGMENTS) {
		const batch = requests.slice(start, start + CONCURRENT_JUDGMENTS);
		const settled = await Promise.allSettled(
			batch.map((report) => judgeReport(() => detection.run({ input: { report } }))),
		);
		failures += settled.filter((result) => result.status === "rejected").length;
	}
	expect(failures, "Every judgment returned a verdict").toBe(0);
});
