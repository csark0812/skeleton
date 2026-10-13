import { afterEach, describe, expect, it, setSystemTime } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { createContext } from "../core/context.ts";
import { gitFreshnessMessage, runDocMetaRule } from "../rules/doc-meta.ts";

function makeCommittedRepo(lastReviewed: string, committedAt: string): string {
	const root = mkdtempSync(join(tmpdir(), "skeleton-doc-meta-"));
	mkdirSync(join(root, "docs"), { recursive: true });
	writeFileSync(
		join(root, "skeleton.toml"),
		'daysUntilStale = 30\n[scan]\ninclude = ["docs/**"]\nexclude = []\n',
	);
	writeFileSync(
		join(root, "docs/example.md"),
		`# Example\n\n<!-- source-of-truth: example behavior -->\n\n<!-- doc-meta: owner=eng | last-reviewed=${lastReviewed} -->\n`,
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
			env: { ...process.env, GIT_AUTHOR_DATE: committedAt, GIT_COMMITTER_DATE: committedAt },
		});
		if (result.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
	}
	return root;
}

function docMetaIssues(root: string) {
	return runDocMetaRule(createContext({ root, paths: ["docs/example.md"] }));
}

afterEach(() => {
	setSystemTime();
});

describe("doc-meta stale content message", () => {
	it("requires a full content review before changing last-reviewed", () => {
		expect(gitFreshnessMessage("2026-08-16", "2026-08-17")).toBe(
			"content changed after last-reviewed 2026-08-16 (git: 2026-08-17) — REQUIRED: re-read the entire document, then bump last-reviewed only if the content is still correct; do not change the date alone",
		);
	});
});

describe("doc-meta timestamp stamps", () => {
	it("flags a stale timestamp by its exact age", () => {
		const root = makeCommittedRepo("2026-08-01T12:00:00Z", "2026-08-01T00:00:00Z");
		try {
			setSystemTime(new Date("2026-08-31T11:00:00Z"));
			expect(docMetaIssues(root)).toEqual([]);
			setSystemTime(new Date("2026-08-31T13:00:00Z"));
			expect(docMetaIssues(root)).toContainEqual(
				expect.objectContaining({
					message: expect.stringContaining(
						"last-reviewed 2026-08-01T12:00:00Z exceeds re-read cadence",
					),
					severity: "warning",
				}),
			);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("compares git freshness by UTC day", () => {
		const behind = makeCommittedRepo("2026-08-16T23:59:59Z", "2026-08-17T00:30:00Z");
		const sameDay = makeCommittedRepo("2026-08-17T00:10:00Z", "2026-08-17T00:30:00Z");
		try {
			setSystemTime(new Date("2026-08-18T00:00:00Z"));
			expect(docMetaIssues(behind)).toContainEqual(
				expect.objectContaining({
					code: "review-behind-git-edit",
					message: gitFreshnessMessage("2026-08-16T23:59:59Z", "2026-08-17"),
				}),
			);
			expect(docMetaIssues(sameDay)).toEqual([]);
		} finally {
			rmSync(behind, { recursive: true, force: true });
			rmSync(sameDay, { recursive: true, force: true });
		}
	});
});
