import { afterEach, describe, expect, it, setSystemTime } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { evaluateValidateChanged } from "../../validate/changed.ts";
import { commitAll, git } from "../support/git-repo.ts";

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

<!-- doc-meta: owner=eng -->

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
		expect(result.impactedDocuments.map((item) => item.path)).toEqual(["docs/example.md"]);
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

	describe("a changed declared dependency", () => {
		function setupRepo(deps = "src/example.ts"): string {
			const root = makeRoot();
			writeToml(root);
			writeOwnedDoc(root, `<!-- review-deps: paths=${deps} -->\n`);
			mkdirSync(join(root, "src"), { recursive: true });
			writeFileSync(join(root, "src/example.ts"), "export const runThing = 1;\n");
			writeFileSync(
				join(root, "package.json"),
				`${JSON.stringify({ name: "x", version: "1.0.0", scripts: { test: "bun test" } })}\n`,
			);
			commitAll(root, "init");
			return root;
		}

		function staleDiagnostics(result: Awaited<ReturnType<typeof evaluateValidateChanged>>) {
			return result.diagnostics
				.filter((item) => item.code === "review-dependency-changed")
				.map((item) => [item.file, item.link, item.severity]);
		}

		it("blocks a commit that changes the dependency but not the document", async () => {
			const root = setupRepo();
			writeFileSync(join(root, "src/example.ts"), "export const runThing = 2;\n");
			git(root, "add", "src/example.ts");
			const result = await evaluateValidateChanged({ root, staged: true });
			expect(result.exitCode).toBe(1);
			expect(staleDiagnostics(result)).toEqual([["docs/example.md", "src/example.ts", "error"]]);
		});

		it("passes once the same commit updates the document", async () => {
			const root = setupRepo();
			writeFileSync(join(root, "src/example.ts"), "export const runThing = 2;\n");
			const doc = join(root, "docs/example.md");
			writeFileSync(
				doc,
				readFileSync(doc, "utf8").replace("example behavior.", "example behavior, now 2."),
			);
			git(root, "add", "-A");
			const result = await evaluateValidateChanged({ root, staged: true });
			expect(staleDiagnostics(result)).toEqual([]);
		});

		it("only warns on a branch range and in the working tree", async () => {
			const root = setupRepo();
			git(root, "checkout", "-q", "-b", "feature");
			writeFileSync(join(root, "src/example.ts"), "export const runThing = 2;\n");
			expect(staleDiagnostics(await evaluateValidateChanged({ root }))).toEqual([
				["docs/example.md", "src/example.ts", "warning"],
			]);
			commitAll(root, "change source");
			const range = await evaluateValidateChanged({ root, base: "main" });
			expect(staleDiagnostics(range)).toEqual([["docs/example.md", "src/example.ts", "warning"]]);
			expect(range.diagnostics.some((item) => item.severity === "error")).toBe(false);
		});

		it("ignores a package version bump and keys outside a selector", async () => {
			const root = setupRepo("src/example.ts,package.json#scripts");
			writeFileSync(
				join(root, "package.json"),
				`${JSON.stringify({ name: "x", version: "1.0.1", scripts: { test: "bun test" } })}\n`,
			);
			git(root, "add", "package.json");
			expect(staleDiagnostics(await evaluateValidateChanged({ root, staged: true }))).toEqual([]);
			writeFileSync(
				join(root, "package.json"),
				`${JSON.stringify({ name: "x", version: "1.0.1", scripts: { test: "vitest" } })}\n`,
			);
			git(root, "add", "package.json");
			expect(staleDiagnostics(await evaluateValidateChanged({ root, staged: true }))).toEqual([
				["docs/example.md", "package.json", "error"],
			]);
		});

		it("reports a deleted file that a dependency glob matched", async () => {
			const root = setupRepo("src/**/*.ts");
			git(root, "rm", "-q", "src/example.ts");
			expect(staleDiagnostics(await evaluateValidateChanged({ root, staged: true }))).toEqual([
				["docs/example.md", "src/example.ts", "error"],
			]);
		});
	});
});
