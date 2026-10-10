import { afterEach, describe, expect, it, setSystemTime } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { attestDocuments } from "../../audit/core/review-proof.ts";
import { evaluateValidateChanged } from "../../validate/changed.ts";

let tempDirs: string[] = [];

function makeRoot(): string {
	const root = mkdtempSync(join(tmpdir(), "skel-hook-"));
	tempDirs.push(root);
	return root;
}

function writeToml(root: string, extra = ""): void {
	writeFileSync(
		join(root, "skeleton.toml"),
		`daysUntilStale = 365
[scan]
include = ["docs/**"]
exclude = []
${extra}
`,
	);
}

function writeOwnedDoc(root: string, extra = ""): void {
	mkdirSync(join(root, "docs"), { recursive: true });
	writeFileSync(
		join(root, "docs/example.md"),
		`# Example

<!-- source-of-truth: example runThing behavior -->

<!-- doc-meta: owner=eng | last-reviewed=2026-08-01 -->

${extra}
The runThing export provides the example behavior.
`,
	);
}

function runGit(root: string, args: string[], env: Record<string, string> = {}): void {
	const result = spawnSync("git", args, {
		cwd: root,
		encoding: "utf8",
		env: {
			...process.env,
			...env,
			GIT_AUTHOR_NAME: "Test",
			GIT_AUTHOR_EMAIL: "test@example.com",
			GIT_COMMITTER_NAME: "Test",
			GIT_COMMITTER_EMAIL: "test@example.com",
		},
	});
	if (result.status !== 0) {
		throw new Error(`git ${args.join(" ")} failed: ${result.stderr || result.stdout}`);
	}
}

afterEach(() => {
	setSystemTime();
	for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
	tempDirs = [];
});

describe("validate changed hook gates", () => {
	it("fails mixed docs and uncovered code", async () => {
		const root = makeRoot();
		writeToml(root);
		writeOwnedDoc(root);
		mkdirSync(join(root, "src"), { recursive: true });
		writeFileSync(join(root, "src/example.ts"), "export const n = 1;\n");

		const result = await evaluateValidateChanged({
			root,
			paths: ["docs/example.md", "src/example.ts"],
		});
		expect(result.exitCode).toBe(1);
		expect(result.diagnostics).toContainEqual(
			expect.objectContaining({ code: "uncovered-changed-path", file: "src/example.ts" }),
		);
		expect(result.audits.some((audit) => audit.suite === "docs")).toBe(true);
	});

	it("fails mixed docs and uncovered production .mjs", async () => {
		const root = makeRoot();
		writeToml(root);
		writeOwnedDoc(root);
		mkdirSync(join(root, "src"), { recursive: true });
		writeFileSync(join(root, "src/app.mjs"), "export const n = 1;\n");

		const result = await evaluateValidateChanged({
			root,
			paths: ["docs/example.md", "src/app.mjs"],
		});
		expect(result.exitCode).toBe(1);
		expect(result.diagnostics).toContainEqual(
			expect.objectContaining({ code: "uncovered-changed-path", file: "src/app.mjs" }),
		);
		expect(result.audits.some((audit) => audit.suite === "docs")).toBe(true);
	});

	it("fails uncovered production .mjs under --base after global rules", async () => {
		const root = makeRoot();
		writeToml(root);
		writeOwnedDoc(root);
		mkdirSync(join(root, "src"), { recursive: true });
		writeFileSync(join(root, "src/app.mjs"), "export const n = 1;\n");

		const result = await evaluateValidateChanged({
			root,
			paths: ["src/app.mjs"],
			base: "HEAD",
		});
		expect(result.exitCode).toBe(1);
		expect(result.diagnostics).toContainEqual(
			expect.objectContaining({ code: "uncovered-changed-path", file: "src/app.mjs" }),
		);
		expect(result.audits.some((audit) => audit.suite === "self")).toBe(true);
	});

	it("fails uncovered code under --base after global rules", async () => {
		const root = makeRoot();
		writeToml(root);
		writeOwnedDoc(root);
		mkdirSync(join(root, "src"), { recursive: true });
		writeFileSync(join(root, "src/example.ts"), "export const n = 1;\n");

		const result = await evaluateValidateChanged({
			root,
			paths: ["src/example.ts"],
			base: "HEAD",
		});
		expect(result.exitCode).toBe(1);
		expect(result.diagnostics).toContainEqual(
			expect.objectContaining({ code: "uncovered-changed-path", file: "src/example.ts" }),
		);
		expect(result.audits.some((audit) => audit.suite === "self")).toBe(true);
	});

	it("does not flag uncovered code when reviewCoverage include is empty", async () => {
		const root = makeRoot();
		writeToml(root, "[reviewCoverage]\ninclude = []\n");
		writeOwnedDoc(root);
		mkdirSync(join(root, "src"), { recursive: true });
		writeFileSync(join(root, "src/example.ts"), "export const n = 1;\n");

		const result = await evaluateValidateChanged({
			root,
			paths: ["docs/example.md", "src/example.ts"],
		});
		expect(result.diagnostics.some((item) => item.code === "uncovered-changed-path")).toBe(false);
	});

	it("does not treat owned code as uncovered", async () => {
		const root = makeRoot();
		writeToml(root);
		writeOwnedDoc(root, "<!-- review-deps: paths=src/example.ts -->\n");
		mkdirSync(join(root, "src"), { recursive: true });
		writeFileSync(join(root, "src/example.ts"), "export const n = 1;\n");

		const result = await evaluateValidateChanged({
			root,
			paths: ["src/example.ts"],
		});
		expect(result.diagnostics.some((item) => item.code === "uncovered-changed-path")).toBe(false);
		expect(result.diagnostics).toContainEqual(
			expect.objectContaining({ code: "impacted-document-review-required" }),
		);
	});

	it("does not flag deleted coverage files as uncovered", async () => {
		const root = makeRoot();
		writeToml(root);
		writeOwnedDoc(root);
		mkdirSync(join(root, "src"), { recursive: true });
		writeFileSync(join(root, "src/gone.ts"), "export const gone = 1;\n");
		runGit(root, ["init"]);
		runGit(root, ["add", "-A"]);
		runGit(root, ["commit", "-m", "init"]);
		runGit(root, ["rm", "src/gone.ts"]);
		runGit(root, ["commit", "-m", "remove gone"]);

		const result = await evaluateValidateChanged({
			root,
			base: "HEAD~1",
		});
		expect(result.diagnostics.some((item) => item.code === "uncovered-changed-path")).toBe(false);
		expect(result.diagnostics.some((item) => item.file === "src/gone.ts")).toBe(false);
	});

	it("fails --staged when attested lockfile and document stay unstaged", async () => {
		const root = makeRoot();
		writeToml(
			root,
			`[reviewProof]
mode = "hash"
`,
		);
		writeOwnedDoc(root, "<!-- review-deps: paths=src/example.ts -->\n");
		mkdirSync(join(root, "src"), { recursive: true });
		writeFileSync(join(root, "src/example.ts"), "export const runThing = 1;\n");
		attestDocuments({ root, paths: ["docs/example.md"], reviewedAt: "2026-08-01" });
		runGit(root, ["init"]);
		runGit(root, ["add", "-A"]);
		runGit(root, ["commit", "-m", "init"]);

		writeFileSync(join(root, "src/example.ts"), "export const runThing = 2;\n");
		runGit(root, ["add", "src/example.ts"]);
		attestDocuments({ root, paths: ["docs/example.md"], reviewedAt: "2026-09-13" });

		const result = await evaluateValidateChanged({ root, staged: true });
		expect(result.exitCode).toBe(1);
		expect(result.diagnostics.some((item) => item.code === "stage-required")).toBe(true);
		expect(
			result.audits
				.flatMap((audit) => audit.diagnostics)
				.some((item) => item.code === "review-dependency-changed"),
		).toBe(true);
	});

	describe("date mode with --base", () => {
		function commitAt(root: string, args: string[], iso: string): void {
			runGit(root, args, { GIT_AUTHOR_DATE: iso, GIT_COMMITTER_DATE: iso });
		}

		function setupRange(lastReviewed: string): string {
			const root = makeRoot();
			writeToml(root);
			writeOwnedDoc(root, "<!-- review-deps: paths=src/example.ts -->\n");
			mkdirSync(join(root, "src"), { recursive: true });
			writeFileSync(join(root, "src/example.ts"), "export const runThing = 1;\n");
			runGit(root, ["init", "-b", "main"]);
			runGit(root, ["add", "-A"]);
			commitAt(root, ["commit", "-m", "init"], "2026-10-01T12:00:00Z");
			runGit(root, ["checkout", "-b", "feature"]);
			writeFileSync(join(root, "src/example.ts"), "export const runThing = 2;\n");
			const doc = join(root, "docs/example.md");
			const text = readFileSync(doc, "utf8");
			writeFileSync(doc, text.replace("last-reviewed=2026-08-01", `last-reviewed=${lastReviewed}`));
			runGit(root, ["add", "-A"]);
			commitAt(root, ["commit", "-m", "change source and review doc"], "2026-10-09T23:30:00Z");
			return root;
		}

		async function reviewRequired(root: string, now: string): Promise<boolean> {
			setSystemTime(new Date(now));
			const result = await evaluateValidateChanged({ root, base: "main" });
			return result.diagnostics.some((item) => item.code === "impacted-document-review-required");
		}

		it("gives the same result for the same range before and after UTC midnight", async () => {
			const root = setupRange("2026-10-09");
			expect(await reviewRequired(root, "2026-10-09T23:45:00Z")).toBe(false);
			expect(await reviewRequired(root, "2026-10-10T00:41:00Z")).toBe(false);
		});

		it("requires a review date on or after the latest dependency commit", async () => {
			const root = setupRange("2026-10-08");
			expect(await reviewRequired(root, "2026-10-09T23:45:00Z")).toBe(true);
			expect(await reviewRequired(root, "2026-10-10T00:41:00Z")).toBe(true);
		});

		it("ignores later merge commits that do not change the dependency", async () => {
			const root = setupRange("2026-10-09");
			runGit(root, ["checkout", "main"]);
			writeFileSync(join(root, "README.md"), "# Readme\n");
			runGit(root, ["add", "-A"]);
			commitAt(root, ["commit", "-m", "main moves"], "2026-10-10T00:20:00Z");
			runGit(root, ["checkout", "feature"]);
			commitAt(root, ["merge", "--no-ff", "-m", "merge main", "main"], "2026-10-10T00:41:00Z");
			expect(await reviewRequired(root, "2026-10-10T00:45:00Z")).toBe(false);
		});
	});
});
