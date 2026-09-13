import { describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../config/load.ts";
import { evaluateAudit } from "../run.ts";

function makeRepo(marker: string): string {
	const root = mkdtempSync(join(tmpdir(), "skeleton-review-coverage-"));
	mkdirSync(join(root, "docs"), { recursive: true });
	mkdirSync(join(root, "src"), { recursive: true });
	writeFileSync(
		join(root, "skeleton.toml"),
		`daysUntilStale = 365
[scan]
include = ["docs/**"]
exclude = []
[reviewCoverage]
include = ["src/**/*.ts"]
exclude = []
`,
	);
	writeFileSync(join(root, "src/owned.ts"), "export const owned = 1;\n");
	writeFileSync(join(root, "src/orphan.ts"), "export const orphan = 1;\n");
	writeFileSync(
		join(root, "docs/example.md"),
		`# Example

<!-- source-of-truth: example -->

<!-- doc-meta: owner=eng | last-reviewed=2099-01-01 -->

${marker}
`,
	);
	return root;
}

describe("review-coverage", () => {
	it("accepts reviewCoverage config", () => {
		const root = makeRepo("<!-- review-deps: paths=src/owned.ts -->");
		try {
			expect(loadConfig(root).reviewCoverage).toEqual({
				include: ["src/**/*.ts"],
				exclude: [],
			});
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("errors on files in the coverage include that no document claims", async () => {
		const root = makeRepo("<!-- review-deps: paths=src/owned.ts -->");
		try {
			const result = await evaluateAudit({
				suite: "self",
				strict: false,
				json: false,
				paths: [],
				only: new Set(["review-coverage"]),
				root,
			});
			expect(result.exitCode).toBe(1);
			expect(result.diagnostics).toContainEqual(
				expect.objectContaining({ code: "review-coverage-gap", file: "src/orphan.ts" }),
			);
			expect(result.diagnostics.some((item) => item.file === "src/owned.ts")).toBe(false);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});
