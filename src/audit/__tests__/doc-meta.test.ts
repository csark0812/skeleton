import { afterEach, describe, expect, it, setSystemTime } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { createContext } from "../core/context.ts";
import { attestDocuments } from "../core/review-proof.ts";
import { runDocMetaRule } from "../rules/doc-meta.ts";

function git(root: string, args: string[], committedAt: string): void {
	const result = spawnSync(
		"git",
		[
			"-c",
			"user.name=Fixture",
			"-c",
			"user.email=fixture@example.invalid",
			"-c",
			"core.hooksPath=/dev/null",
			...args,
		],
		{
			cwd: root,
			env: {
				...process.env,
				TZ: "UTC",
				GIT_AUTHOR_DATE: committedAt,
				GIT_COMMITTER_DATE: committedAt,
			},
		},
	);
	if (result.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
}

function makeRepo(meta = "owner=eng"): string {
	const root = mkdtempSync(join(tmpdir(), "skeleton-doc-meta-"));
	mkdirSync(join(root, "docs"), { recursive: true });
	writeFileSync(
		join(root, "skeleton.toml"),
		'daysUntilStale = 30\n[scan]\ninclude = ["docs/**"]\nexclude = []\n',
	);
	writeFileSync(
		join(root, "docs/example.md"),
		`# Example\n\n<!-- source-of-truth: example behavior -->\n\n<!-- doc-meta: ${meta} -->\n`,
	);
	return root;
}

function commitReview(root: string, committedAt: string): void {
	attestDocuments({ root, paths: ["docs/example.md"] });
	git(root, ["init", "-q"], committedAt);
	git(root, ["add", "."], committedAt);
	git(root, ["commit", "-q", "-m", "review"], committedAt);
}

function docMetaIssues(root: string) {
	return runDocMetaRule(createContext({ root, paths: ["docs/example.md"] }));
}

afterEach(() => {
	setSystemTime();
});

describe("doc-meta", () => {
	it("accepts an owner without a review date", () => {
		const root = makeRepo();
		try {
			expect(docMetaIssues(root)).toEqual([]);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("requires the doc-meta comment", () => {
		const root = makeRepo();
		try {
			writeFileSync(join(root, "docs/example.md"), "# Example\n\n<!-- source-of-truth: x -->\n");
			expect(docMetaIssues(root)).toContainEqual(
				expect.objectContaining({ message: expect.stringContaining("missing doc-meta comment") }),
			);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("warns about a legacy last-reviewed date", () => {
		const root = makeRepo("owner=eng | last-reviewed=2026-08-19");
		try {
			expect(docMetaIssues(root)).toEqual([
				expect.objectContaining({ code: "legacy-review-date", severity: "warning" }),
			]);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("measures the re-read cadence from the last commit of the review proof", () => {
		const root = makeRepo();
		try {
			commitReview(root, "2026-08-01T12:00:00Z");
			setSystemTime(new Date("2026-08-31T00:00:00Z"));
			expect(docMetaIssues(root)).toEqual([]);
			setSystemTime(new Date("2026-09-01T00:00:01Z"));
			expect(docMetaIssues(root)).toEqual([
				expect.objectContaining({
					code: "review-cadence-exceeded",
					message: expect.stringContaining("last review was committed 2026-08-01"),
					severity: "warning",
				}),
			]);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("does not measure cadence for an uncommitted review", () => {
		const root = makeRepo();
		try {
			attestDocuments({ root, paths: ["docs/example.md"] });
			setSystemTime(new Date("2030-01-01T00:00:00Z"));
			expect(docMetaIssues(root)).toEqual([]);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});
