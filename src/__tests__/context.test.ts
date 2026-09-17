import { describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { attestDocuments } from "../audit/core/review-proof.ts";
import { evaluateContext, formatContext } from "../context.ts";

function makeRepo(): string {
	const root = mkdtempSync(join(tmpdir(), "skel-context-"));
	mkdirSync(join(root, "docs"), { recursive: true });
	mkdirSync(join(root, "src/billing"), { recursive: true });
	mkdirSync(join(root, "tests"), { recursive: true });
	writeFileSync(
		join(root, "skeleton.toml"),
		`daysUntilStale = 365
[scan]
include = ["docs/**"]
exclude = []
[reviewProof]
mode = "hash"
`,
	);
	writeFileSync(join(root, "src/billing/delivery.ts"), "export const MAX_RETRIES = 1;\n");
	writeFileSync(
		join(root, "tests/billing.test.ts"),
		'import { MAX_RETRIES } from "../src/billing/delivery";\ntest("retries", () => expect(MAX_RETRIES).toBe(1));\n',
	);
	writeFileSync(
		join(root, "docs/billing.md"),
		`# Billing delivery

<!-- source-of-truth: Billing webhook retry policy -->

<!-- doc-meta: owner=billing | last-reviewed=2026-09-16 -->

<!-- review-deps: paths=src/billing/delivery.ts -->

Billing webhooks retry once after a failed delivery.
`,
	);
	attestDocuments({ root, paths: ["docs/billing.md"], reviewedAt: "2026-09-16" });
	return root;
}

describe("context", () => {
	it("returns matching canonical documents, their source owners, and review status", () => {
		const root = makeRepo();
		try {
			const result = evaluateContext({ root, query: "billing webhook retry" });
			expect(result.documents).toEqual([
				expect.objectContaining({
					path: "docs/billing.md",
					review: "matches-recorded-review",
					sources: [expect.objectContaining({ path: "src/billing/delivery.ts" })],
				}),
			]);
			expect(result.documents[0]?.excerpt).toContain("Billing webhooks retry once");
			expect(result.documents[0]?.sources[0]?.excerpt).toContain("MAX_RETRIES = 1");
			expect(result.documents[0]?.tests).toEqual([
				expect.objectContaining({ path: "tests/billing.test.ts" }),
			]);
			expect(formatContext(result)).toContain("test\ttests/billing.test.ts");
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("reports changed source dependencies instead of presenting stale review evidence", () => {
		const root = makeRepo();
		try {
			writeFileSync(join(root, "src/billing/delivery.ts"), "export const MAX_RETRIES = 2;\n");
			const result = evaluateContext({ root, path: "src/billing/delivery.ts" });
			expect(result.documents).toEqual([
				expect.objectContaining({
					path: "docs/billing.md",
					review: "changed-since-review",
				}),
			]);
			expect(formatContext(result)).toContain(
				"action\tdocs/billing.md\tBefore finishing, compare every claim in the final document with the returned sources and correct every mismatch.",
			);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("resolves declared dependency globs to the evidence files they own", () => {
		const root = makeRepo();
		try {
			writeFileSync(
				join(root, "docs/billing.md"),
				`# Billing delivery

<!-- source-of-truth: Billing webhook retry policy -->

<!-- review-deps: paths=src/billing/*.ts -->

Billing webhooks retry once after a failed delivery.
`,
			);
			const result = evaluateContext({ root, query: "billing retry" });
			expect(result.documents[0]?.sources).toEqual([
				expect.objectContaining({ path: "src/billing/delivery.ts" }),
			]);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("centers bounded source excerpts on the strongest query-term match", () => {
		const root = makeRepo();
		try {
			writeFileSync(
				join(root, "src/billing/delivery.ts"),
				[
					"export const validationMode = 'strict';",
					"x".repeat(2_000),
					"export function uncoveredChangedPathForDeletedSource() {",
					'\treturn "uncovered-changed-path deleted source";',
					"}",
				].join("\n"),
			);
			const result = evaluateContext({
				root,
				query: "validation uncovered changed path deleted source",
				maxChars: 2_000,
			});
			expect(result.documents[0]?.sources[0]?.excerpt).toContain(
				"uncovered-changed-path deleted source",
			);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});
