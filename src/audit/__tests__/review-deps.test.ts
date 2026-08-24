import { describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseReviewDepsMarkers, resolveReviewDependencies } from "../core/review-deps.ts";
import { evaluateAudit } from "../run.ts";

function makeRepo(docMarker: string): string {
	const root = mkdtempSync(join(tmpdir(), "skeleton-review-deps-"));
	mkdirSync(join(root, "docs"), { recursive: true });
	mkdirSync(join(root, "commands"), { recursive: true });
	writeFileSync(join(root, "commands/build.sh"), "#!/bin/sh\n");
	writeFileSync(
		join(root, "skeleton.toml"),
		'daysUntilStale = 365\n[scan]\ninclude = ["docs/**"]\nexclude = []\n',
	);
	writeFileSync(
		join(root, "docs/example.md"),
		`# Example\n\n<!-- source-of-truth: example -->\n\n<!-- doc-meta: owner=eng | last-reviewed=2099-01-01 -->\n\n${docMarker}\n`,
	);
	return root;
}

describe("review-deps", () => {
	it("parses comma-separated paths and resolves globs", () => {
		const markers = parseReviewDepsMarkers(
			"<!-- review-deps: paths=package.json,commands/** -->\n`<!-- review-deps: paths=ignored -->`",
		);
		expect(markers).toEqual([
			{ paths: ["package.json", "commands/**"], raw: "paths=package.json,commands/**" },
		]);
		const root = makeRepo("<!-- review-deps: paths=commands/** -->");
		try {
			expect(resolveReviewDependencies(root, ["commands/**"]).targets).toEqual([
				"commands/build.sh",
			]);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("errors on missing exact paths and warns on empty globs", async () => {
		const exactRoot = makeRepo("<!-- review-deps: paths=missing.json -->");
		try {
			const exact = await evaluateAudit({
				suite: "docs",
				strict: false,
				json: false,
				paths: ["docs/example.md"],
				only: new Set(["review-deps"]),
				root: exactRoot,
			});
			expect(exact.diagnostics).toContainEqual(expect.objectContaining({ rule: "review-deps" }));
		} finally {
			rmSync(exactRoot, { recursive: true, force: true });
		}

		const globRoot = makeRepo("<!-- review-deps: paths=missing/** -->");
		try {
			const warning = await evaluateAudit({
				suite: "docs",
				strict: false,
				json: false,
				paths: ["docs/example.md"],
				only: new Set(["review-deps"]),
				root: globRoot,
			});
			expect(warning.exitCode).toBe(0);
			expect(warning.diagnostics).toContainEqual(
				expect.objectContaining({ code: "review-dependency-glob-empty", severity: "warning" }),
			);
			const strict = await evaluateAudit({
				suite: "docs",
				strict: true,
				json: false,
				paths: ["docs/example.md"],
				only: new Set(["review-deps"]),
				root: globRoot,
			});
			expect(strict.exitCode).toBe(1);
		} finally {
			rmSync(globRoot, { recursive: true, force: true });
		}
	});
});
