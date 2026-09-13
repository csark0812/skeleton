import { afterEach, describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
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

function runGit(root: string, args: string[]): void {
	const result = spawnSync("git", args, {
		cwd: root,
		encoding: "utf8",
		env: {
			...process.env,
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
});
