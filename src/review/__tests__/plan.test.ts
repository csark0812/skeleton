import { describe, expect, it } from "bun:test";
import {
	DEFAULT_REVIEWERS,
	formatReviewPlan,
	isInstructionFileName,
	LIGHT_MAX_PROSE_LINES,
	type ReviewedPath,
	reviewPlan,
} from "../plan.ts";

function plan(paths: ReviewedPath[], extra: Partial<Parameters<typeof reviewPlan>[0]> = {}) {
	return reviewPlan({
		paths,
		isInstructionFile: (path) =>
			isInstructionFileName(path) || path.startsWith("skills/demo/references/"),
		humanReviewRequired: [],
		documentsToReread: 0,
		...extra,
	});
}

describe("reviewPlan", () => {
	it("gives a prose-only change one review", () => {
		expect(plan([{ path: "docs/product/badge-scanning.md", lines: 1 }])).toEqual({
			tier: "light",
			reviewers: 1,
			reasons: ["prose only, 1 lines"],
		});
	});

	it("keeps two reviews for a one-line code change", () => {
		expect(plan([{ path: "src/a.ts", lines: 1 }])).toMatchObject({
			tier: "full",
			reviewers: DEFAULT_REVIEWERS,
		});
	});

	it.each([
		["a test-only change", "src/__tests__/a.test.ts"],
		["a config change", "skeleton.toml"],
		["a skill", "skills/demo/SKILL.md"],
		["a skill reference", "skills/demo/references/operations.md"],
		["agent instructions", "AGENTS.md"],
		["a review guide", "docs/billing/REVIEW.md"],
	])("keeps two reviews for %s", (_name, path) => {
		expect(plan([{ path, lines: 1 }]).tier).toBe("full");
	});

	it("keeps two reviews when prose and code change together", () => {
		const result = plan([
			{ path: "docs/a.md", lines: 1 },
			{ path: "src/a.tsx", lines: 2 },
		]);
		expect(result.tier).toBe("full");
		expect(result.reasons).toEqual(["not prose-only: src/a.tsx"]);
	});

	it("keeps two reviews when human-review paths or documents to re-read are listed", () => {
		const prose = [{ path: "docs/a.md", lines: 1 }];
		expect(plan(prose, { humanReviewRequired: ["docs/a.md"] }).tier).toBe("full");
		expect(plan(prose, { documentsToReread: 1 }).tier).toBe("full");
	});

	it("keeps two reviews for a prose change over the line cap or a binary one", () => {
		expect(plan([{ path: "docs/a.md", lines: LIGHT_MAX_PROSE_LINES }]).tier).toBe("light");
		expect(plan([{ path: "docs/a.md", lines: LIGHT_MAX_PROSE_LINES + 1 }]).tier).toBe("full");
		expect(plan([{ path: "docs/a.md", lines: null }]).tier).toBe("full");
	});

	it("keeps two reviews when nothing is reviewable", () => {
		expect(plan([]).tier).toBe("full");
	});

	it("uses [review] reviewers as a fixed override at any size", () => {
		expect(plan([{ path: "docs/a.md", lines: 1 }], { configuredReviewers: 3 })).toMatchObject({
			tier: "configured",
			reviewers: 3,
		});
		expect(plan([{ path: "src/a.ts", lines: 1 }], { configuredReviewers: 1 }).reviewers).toBe(1);
	});

	it("prints the count the author must start", () => {
		expect(
			formatReviewPlan({ tier: "light", reviewers: 1, reasons: ["prose only, 1 lines"] }),
		).toBe(
			"review prepare: light review, 1 reviewer (prose only, 1 lines); start exactly that many",
		);
	});
});
