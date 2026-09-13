import { describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { CATALOG_REL_PATH } from "../audit/core/shared.ts";
import { evaluateAudit } from "../audit/run.ts";
import { evaluateValidateChanged } from "../validate/changed.ts";

function withLocalCi(ci: string | undefined, run: () => Promise<void>): Promise<void> {
	const previous = process.env.CI;
	if (ci === undefined) delete process.env.CI;
	else process.env.CI = ci;
	return run().finally(() => {
		if (previous === undefined) delete process.env.CI;
		else process.env.CI = previous;
	});
}

function makeDocsRepo(): string {
	const root = mkdtempSync(join(tmpdir(), "skel-catalog-refresh-"));
	mkdirSync(join(root, "docs"), { recursive: true });
	writeFileSync(
		join(root, "skeleton.toml"),
		'daysUntilStale = 365\n[scan]\ninclude = ["docs/**"]\nexclude = []\n',
	);
	writeFileSync(
		join(root, "docs/a.md"),
		`# Alpha

<!-- source-of-truth: Alpha topic -->

<!-- doc-meta: owner=eng | last-reviewed=2099-01-01 -->

Alpha body with topic words.
`,
	);
	return root;
}

function docsAudit(root: string) {
	return evaluateAudit({
		suite: "docs",
		strict: false,
		json: false,
		paths: ["docs/a.md"],
		only: new Set(["doc-meta"]),
		root,
	});
}

describe("local catalog refresh", () => {
	it("writes a missing catalog during local docs audit and does not warn", async () => {
		const root = makeDocsRepo();
		await withLocalCi(undefined, async () => {
			try {
				const catalog = join(root, CATALOG_REL_PATH);
				expect(existsSync(catalog)).toBe(false);
				const result = await docsAudit(root);
				expect(existsSync(catalog)).toBe(true);
				expect(readFileSync(catalog, "utf8")).toContain("Alpha topic");
				expect(result.catalog.status).toBe("current");
				expect(result.diagnostics.some((item) => item.rule === "catalog")).toBe(false);
			} finally {
				rmSync(root, { recursive: true, force: true });
			}
		});
	});

	it("refreshes a stale catalog during local docs audit", async () => {
		const root = makeDocsRepo();
		await withLocalCi(undefined, async () => {
			try {
				const catalog = join(root, CATALOG_REL_PATH);
				mkdirSync(join(root, ".skeleton"), { recursive: true });
				writeFileSync(catalog, "# stale catalog\n");
				await docsAudit(root);
				expect(readFileSync(catalog, "utf8")).toContain("Alpha topic");
			} finally {
				rmSync(root, { recursive: true, force: true });
			}
		});
	});

	it("skips catalog writes when CI=true", async () => {
		const root = makeDocsRepo();
		await withLocalCi("true", async () => {
			try {
				const result = await docsAudit(root);
				expect(existsSync(join(root, CATALOG_REL_PATH))).toBe(false);
				expect(result.catalog.status).toBe("skipped-ci");
				expect(result.diagnostics.some((item) => item.rule === "catalog")).toBe(false);
			} finally {
				rmSync(root, { recursive: true, force: true });
			}
		});
	});

	it("writes a missing catalog during local validate changed", async () => {
		const root = makeDocsRepo();
		await withLocalCi(undefined, async () => {
			try {
				await evaluateValidateChanged({ root, paths: ["docs/a.md"] });
				expect(existsSync(join(root, CATALOG_REL_PATH))).toBe(true);
			} finally {
				rmSync(root, { recursive: true, force: true });
			}
		});
	});
});
