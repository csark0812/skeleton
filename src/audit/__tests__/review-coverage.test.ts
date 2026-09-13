import { describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../config/load.ts";
import { collectReviewCoverageFiles, pathRequiresReviewCoverage } from "../core/review-coverage.ts";
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

	it("treats production .mjs as a default coverage candidate", () => {
		const root = makeRepo("<!-- review-deps: paths=src/owned.ts -->");
		try {
			writeFileSync(
				join(root, "skeleton.toml"),
				`daysUntilStale = 365
[scan]
include = ["docs/**"]
exclude = []
`,
			);
			const config = loadConfig(root);
			expect(pathRequiresReviewCoverage("src/app.mjs", config)).toBe(true);
			expect(pathRequiresReviewCoverage(".skeleton/plugins/example/example.mjs", config)).toBe(
				false,
			);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("keeps production .mjs covered when include names only that extension", () => {
		const root = makeRepo("<!-- review-deps: paths=src/owned.ts -->");
		try {
			writeFileSync(
				join(root, "skeleton.toml"),
				`daysUntilStale = 365
[scan]
include = ["docs/**"]
exclude = []
[reviewCoverage]
include = ["**/*.mjs"]
`,
			);
			const config = loadConfig(root);
			expect(pathRequiresReviewCoverage("src/app.mjs", config)).toBe(true);
			expect(pathRequiresReviewCoverage(".skeleton/plugins/example/example.mjs", config)).toBe(
				false,
			);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("drops nested vendor trees from the default coverage set", () => {
		const root = makeRepo("<!-- review-deps: paths=src/owned.ts -->");
		try {
			writeFileSync(
				join(root, "skeleton.toml"),
				`daysUntilStale = 365
[scan]
include = ["docs/**"]
exclude = []
`,
			);
			mkdirSync(join(root, "apps/pkg/node_modules/dep"), { recursive: true });
			mkdirSync(join(root, "apps/pkg/dist"), { recursive: true });
			mkdirSync(join(root, "apps/pkg/.venv/lib"), { recursive: true });
			writeFileSync(join(root, "apps/pkg/node_modules/dep/index.js"), "module.exports = 1;\n");
			writeFileSync(join(root, "apps/pkg/dist/out.js"), "export default 1;\n");
			writeFileSync(join(root, "apps/pkg/.venv/lib/site.py"), "x = 1\n");
			writeFileSync(join(root, "apps/pkg/app.ts"), "export const app = 1;\n");

			const config = loadConfig(root);
			expect(pathRequiresReviewCoverage("apps/pkg/node_modules/dep/index.js", config)).toBe(false);
			expect(pathRequiresReviewCoverage("apps/pkg/dist/out.js", config)).toBe(false);
			expect(pathRequiresReviewCoverage("apps/pkg/.venv/lib/site.py", config)).toBe(false);
			expect(pathRequiresReviewCoverage("apps/pkg/app.ts", config)).toBe(true);
			expect(collectReviewCoverageFiles(root, config)).toEqual([
				"apps/pkg/app.ts",
				"src/orphan.ts",
				"src/owned.ts",
			]);
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
