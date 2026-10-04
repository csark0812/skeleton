import { describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
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
	it("requires source comparison for unreviewed claims while preserving historical intent", () => {
		const root = makeRepo();
		try {
			writeFileSync(join(root, ".skeleton/review-lock.json"), "{}\n");
			const packet = formatContext(evaluateContext({ root, query: "billing retry" }));
			expect(packet).toContain("action\tdocs/billing.md\tNo matching recorded review proof");
			expect(packet).toContain("active implementation claims");
			expect(packet).toContain("historical alternatives and future aspirations");
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("surfaces own-edit freshness without requiring hash mode", () => {
		const root = makeRepo();
		try {
			writeFileSync(
				join(root, "skeleton.toml"),
				'daysUntilStale = 365\n[scan]\ninclude = ["docs/**"]\nexclude = []\n',
			);
			for (const args of [
				["init", "-q"],
				["add", "."],
				[
					"-c",
					"user.name=Fixture",
					"-c",
					"user.email=fixture@example.invalid",
					"-c",
					"core.hooksPath=/dev/null",
					"commit",
					"-q",
					"-m",
					"baseline",
				],
			]) {
				const result = spawnSync("git", args, {
					cwd: root,
					env: {
						...process.env,
						GIT_AUTHOR_DATE: "2026-09-17T00:00:00Z",
						GIT_COMMITTER_DATE: "2026-09-17T00:00:00Z",
					},
				});
				expect(result.status).toBe(0);
			}
			const result = evaluateContext({ root, query: "billing retry" });
			expect(result.documents[0]?.review).toBe("review-required");
			expect(formatContext(result)).toContain("content changed after last-reviewed 2026-09-16");
			expect(formatContext(result)).toContain("Do not update the date alone");
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("retains other matched papers when a broad owner has many source dependencies", () => {
		const root = makeRepo();
		try {
			const dependencies = Array.from(
				{ length: 10 },
				(_, index) => `src/billing/source-${index}.ts`,
			);
			for (const path of dependencies)
				writeFileSync(join(root, path), "// billing retry source\n".repeat(300));
			writeFileSync(
				join(root, "docs/billing.md"),
				`<!-- source-of-truth: Billing retry policy -->\n<!-- review-deps: paths=${dependencies.join(",")} -->\nBilling retry implementation.\n`,
			);
			writeFileSync(
				join(root, "docs/product.md"),
				"<!-- source-of-truth: Billing product policy -->\nBilling retry active ownership must agree with implementation.\n",
			);
			const result = evaluateContext({ root, query: "billing retry" });
			expect(result.documents.map((item) => item.path)).toContain("docs/product.md");
			expect(formatContext(result)).toContain("omitted-source\t");
			expect(formatContext(result)).toContain("action\tomitted\t");
			const excerpts = result.documents.flatMap((item) => [
				item.excerpt,
				...item.sources.map((source) => source.excerpt),
				...item.tests.map((test) => test.excerpt),
			]);
			expect(excerpts.reduce((sum, value) => sum + value.length, 0)).toBeLessThanOrEqual(12_000);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("invalidates review evidence when a declared glob loses a source file", () => {
		const root = makeRepo();
		try {
			writeFileSync(
				join(root, "docs/billing.md"),
				"<!-- source-of-truth: Billing retry policy -->\n<!-- doc-meta: owner=eng | last-reviewed=2026-09-16 -->\n<!-- review-deps: paths=src/billing/*.ts -->\nBilling retries once.\n",
			);
			writeFileSync(join(root, "src/billing/retired.ts"), "export const retired = true;\n");
			attestDocuments({ root, paths: ["docs/billing.md"], reviewedAt: "2026-09-16" });
			rmSync(join(root, "src/billing/retired.ts"));
			const result = evaluateContext({ root, query: "billing retry" });
			expect(result.documents[0]?.review).toBe("changed-since-review");
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
	it("loads a clean copy of the packaged skill in a consumer repository", () => {
		const root = mkdtempSync(join(tmpdir(), "skel-context-consumer-"));
		try {
			mkdirSync(join(root, ".claude/skills"), { recursive: true });
			cpSync(join(import.meta.dir, "../../skeleton"), join(root, ".claude/skills/skeleton"), {
				recursive: true,
			});
			writeFileSync(
				join(root, "skeleton.toml"),
				`daysUntilStale = 365\n[scan]\ninclude = [".claude/skills/**"]\nexclude = []\n`,
			);

			expect(() => evaluateContext({ root, query: "skeleton context" })).not.toThrow();
			expect(evaluateContext({ root, query: "skeleton context" }).documents).toEqual([
				expect.objectContaining({ path: ".claude/skills/skeleton/SKILL.md" }),
			]);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

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
				"action\tdocs/billing.md\tReturned source excerpts are authoritative current behavior.",
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
				query: "billing validation uncovered changed path deleted source",
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
