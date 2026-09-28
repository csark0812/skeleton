import { describe, expect, it } from "bun:test";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
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

	it("keeps a late self-resolution check ahead of long changelog and test excerpts", () => {
		const root = makeRepo();
		try {
			writeFileSync(
				join(root, "src/billing/delivery.ts"),
				`// fallback resolver handles package imports in a monorepo
${"// unrelated implementation note\n".repeat(180)}
// Self-resolution
const pkg = context.getPackageForModule(originModulePath);
const pkgName = pkg?.packageJson.name;
if (pkgName === moduleName) resolveFrom(pkg.rootPath);
`,
			);
			writeFileSync(join(root, "tests/billing.test.ts"), "// fallback resolver test\n".repeat(350));
			writeFileSync(
				join(root, "tests/other.test.ts"),
				"// package fallback resolver test monorepo\n".repeat(350),
			);
			writeFileSync(join(root, "docs/changelog.md"), "fallback resolver package\n".repeat(350));
			writeFileSync(
				join(root, "docs/billing.md"),
				`# Package fallback resolver

<!-- source-of-truth: package self-resolution fallback -->
<!-- review-deps: paths=docs/changelog.md,tests/billing.test.ts,src/billing/delivery.ts -->

The fallback resolver handles a package importing itself in a monorepo.
`,
			);
			const result = evaluateContext({
				root,
				query: "package importing itself monorepo fallback resolver tests changelog",
			});
			expect(result.documents[0]?.sources[0]?.path).toBe("src/billing/delivery.ts");
			expect(result.documents[0]?.sources[0]?.excerpt).toContain("packageJson.name");
			expect(result.documents[0]?.sources.map((source) => source.path)).toContain(
				"docs/changelog.md",
			);
			expect(result.documents[0]?.tests[0]?.path).toBe("tests/billing.test.ts");
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});
