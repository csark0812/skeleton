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

function auditCodes(result: Awaited<ReturnType<typeof evaluateValidateChanged>>): string[] {
	return result.audits.flatMap((audit) => audit.diagnostics).map((item) => item.code ?? "");
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
		expect(auditCodes(result)).toContain("review-proof-missing");
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

	it("fails --staged when the attested proof file stays unstaged", async () => {
		const root = makeRoot();
		writeToml(root);
		writeOwnedDoc(root, "<!-- review-deps: paths=src/example.ts -->\n");
		mkdirSync(join(root, "src"), { recursive: true });
		writeFileSync(join(root, "src/example.ts"), "export const runThing = 1;\n");
		attestDocuments({ root, paths: ["docs/example.md"] });
		runGit(root, ["init"]);
		runGit(root, ["add", "-A"]);
		runGit(root, ["commit", "-m", "init"]);

		writeFileSync(join(root, "src/example.ts"), "export const runThing = 2;\n");
		runGit(root, ["add", "src/example.ts"]);
		attestDocuments({
			root,
			paths: ["docs/example.md"],
			reason: "checked against the changed code",
		});

		const result = await evaluateValidateChanged({ root, staged: true });
		expect(result.exitCode).toBe(1);
		expect(result.diagnostics).toContainEqual(
			expect.objectContaining({
				code: "stage-required",
				file: ".skeleton/review-lock.toml",
			}),
		);
		expect(
			result.audits
				.flatMap((audit) => audit.diagnostics)
				.some((item) => item.code === "review-dependency-changed"),
		).toBe(true);
	});

	describe("hash proof for an impacted document", () => {
		function setupRepo(): string {
			const root = makeRoot();
			writeToml(root);
			writeOwnedDoc(root, "<!-- review-deps: paths=src/example.ts -->\n");
			mkdirSync(join(root, "src"), { recursive: true });
			writeFileSync(join(root, "src/example.ts"), "export const runThing = 1;\n");
			attestDocuments({ root, paths: ["docs/example.md"] });
			runGit(root, ["init", "-b", "main"]);
			runGit(root, ["add", "-A"]);
			runGit(root, ["commit", "-m", "init"]);
			return root;
		}

		it("requires a re-read when a dependency changes, and passes once it is attested", async () => {
			const root = setupRepo();
			writeFileSync(join(root, "src/example.ts"), "export const runThing = 2;\n");
			const before = await evaluateValidateChanged({ root });
			expect(before.exitCode).toBe(1);
			expect(auditCodes(before)).toContain("review-dependency-changed");

			const doc = readFileSync(join(root, "docs/example.md"), "utf8");
			attestDocuments({
				root,
				paths: ["docs/example.md"],
				reason: "checked against the changed code",
			});
			expect(readFileSync(join(root, "docs/example.md"), "utf8")).toBe(doc);
			const after = await evaluateValidateChanged({ root });
			expect(auditCodes(after)).not.toContain("review-dependency-changed");
		});

		it("checks a --base range by bytes, not by commit dates", async () => {
			const root = setupRepo();
			runGit(root, ["checkout", "-b", "feature"]);
			writeFileSync(join(root, "src/example.ts"), "export const runThing = 2;\n");
			runGit(root, ["commit", "-am", "change source"]);
			expect(auditCodes(await evaluateValidateChanged({ root, base: "main" }))).toContain(
				"review-dependency-changed",
			);

			attestDocuments({
				root,
				paths: ["docs/example.md"],
				reason: "checked against the changed code",
			});
			runGit(root, ["add", "-A"]);
			runGit(root, ["commit", "-m", "review doc"]);
			setSystemTime(new Date("2030-01-01T00:00:00Z"));
			expect(auditCodes(await evaluateValidateChanged({ root, base: "main" }))).not.toContain(
				"review-dependency-changed",
			);
		});
	});
});
