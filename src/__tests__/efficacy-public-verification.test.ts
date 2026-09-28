import { afterEach, describe, expect, it } from "bun:test";
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import process from "node:process";
import type { QualificationCorpusTask } from "../../scripts/efficacy/corpus.ts";
import {
	verifyExactEdit,
	verifyHistoricalTask,
	verifyKnownUpstreamFix,
	verifyNativeTask,
	verifyReportOutBehavior,
} from "../../scripts/efficacy/public-verification.ts";

const roots: string[] = [];
afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("public exact-edit verifier", () => {
	it("accepts only one precise replacement in one file", () => {
		const root = mkdtempSync(join(tmpdir(), "skeleton-exact-edit-"));
		roots.push(root);
		const initial = join(root, "initial");
		const final = join(root, "final");
		mkdirSync(join(initial, "docs"), { recursive: true });
		mkdirSync(join(final, "docs"), { recursive: true });
		writeFileSync(
			join(initial, "docs/CONTRIBUTING.md"),
			"This project is started by Yusuke Wada.\n",
		);
		writeFileSync(
			join(final, "docs/CONTRIBUTING.md"),
			"This project was started by Yusuke Wada.\n",
		);
		const exactTask = task("1".repeat(40));
		exactTask.verifier = {
			kind: "exact-edit",
			requirements: ["Correct the grammar."],
			expectedPaths: ["docs/CONTRIBUTING.md"],
			exactEdit: {
				path: "docs/CONTRIBUTING.md",
				from: "This project is started by Yusuke Wada",
				to: "This project was started by Yusuke Wada",
			},
		};
		const workspace = { initial, final, changedPaths: ["docs/CONTRIBUTING.md"] };
		expect(verifyExactEdit(exactTask, workspace).passed).toBe(true);
		expect(
			verifyExactEdit(exactTask, {
				...workspace,
				changedPaths: ["docs/CONTRIBUTING.md", "README.md"],
			}).passed,
		).toBe(false);
		writeFileSync(
			join(final, "docs/CONTRIBUTING.md"),
			"This project was started by Yusuke Wada!\n",
		);
		expect(verifyExactEdit(exactTask, workspace).passed).toBe(false);
	});
});

function command(cwd: string, executable: string, args: string[]) {
	return execFileSync(executable, args, { cwd, encoding: "utf8" });
}

function fixture() {
	const root = mkdtempSync(join(tmpdir(), "skeleton-public-verifier-"));
	roots.push(root);
	command(root, "git", ["init", "-q"]);
	command(root, "git", ["config", "user.name", "Verifier"]);
	command(root, "git", ["config", "user.email", "verifier@example.com"]);
	mkdirSync(join(root, "src"));
	writeFileSync(join(root, "src/value.ts"), "export const value = 1;\n");
	writeFileSync(
		join(root, "value.test.ts"),
		'import { expect, test } from "bun:test"; import { value } from "./src/value"; test("value", () => expect(value).toBe(1));\n',
	);
	command(root, "git", ["add", "."]);
	command(root, "git", ["commit", "-qm", "base"]);
	const base = command(root, "git", ["rev-parse", "HEAD"]).trim();
	writeFileSync(join(root, "src/value.ts"), "export const value = 2;\n");
	writeFileSync(
		join(root, "value.test.ts"),
		'import { expect, test } from "bun:test"; import { value } from "./src/value"; test("value", () => expect(value).toBe(2));\n',
	);
	command(root, "git", ["add", "."]);
	command(root, "git", ["commit", "-qm", "reference fix"]);
	const reference = command(root, "git", ["rev-parse", "HEAD"]).trim();
	const final = mkdtempSync(join(tmpdir(), "skeleton-public-final-"));
	roots.push(final);
	rmSync(final, { recursive: true, force: true });
	command(tmpdir(), "git", ["clone", "-q", root, final]);
	command(final, "git", ["checkout", "-q", base]);
	return { root, final, reference };
}

function task(referenceCommit: string, commit = "1".repeat(40)): QualificationCorpusTask {
	return {
		id: "public-history",
		repository: "public/example",
		repositoryUrl: "https://github.com/public/example",
		commit,
		tree: "2".repeat(40),
		license: "MIT",
		upstreamUrl: "https://github.com/public/example/pull/1",
		selectedBy: "test",
		tier: "core",
		kind: "maintenance",
		prompt: "Fix the public example and verify the focused behavior.",
		promptSha256: `sha256:${"3".repeat(64)}`,
		verifier: {
			kind: "historical-patch",
			referenceCommit,
			requirements: ["The hidden regression passes."],
			expectedPaths: ["src/value.ts", "value.test.ts"],
			verificationPaths: ["value.test.ts"],
		},
		verifierSha256: `sha256:${"4".repeat(64)}`,
		nativeTestCommand: "bun test value.test.ts",
		warmTestTimeoutMs: 30_000,
		requirements: ["bun"],
	};
}

describe("public historical verifier", () => {
	it("checks a gitless agent snapshot with the hidden upstream regression", () => {
		const { root, final, reference } = fixture();
		const snapshot = mkdtempSync(join(tmpdir(), "skeleton-public-snapshot-"));
		roots.push(snapshot);
		cpSync(join(final, "src"), join(snapshot, "src"), { recursive: true });
		writeFileSync(join(snapshot, "src/value.ts"), "export const value = 2;\n");
		writeFileSync(
			join(snapshot, "value.test.ts"),
			'import { test } from "bun:test"; test("weakened", () => {});\n',
		);
		const result = verifyHistoricalTask(task(reference), snapshot, root, {
			dependencyWorkspace: final,
		});
		expect(result.passed).toBe(true);
		expect(result.output).toContain("1 pass");
	});

	it("runs a native verifier from a gitless agent snapshot", () => {
		const { final, reference } = fixture();
		const snapshot = mkdtempSync(join(tmpdir(), "skeleton-public-snapshot-"));
		roots.push(snapshot);
		cpSync(join(final, "src"), join(snapshot, "src"), { recursive: true });
		cpSync(join(final, "value.test.ts"), join(snapshot, "value.test.ts"));
		const result = verifyNativeTask(task(reference), snapshot, { dependencyWorkspace: final });
		expect(result.passed).toBe(true);
		expect(result.output).toContain("1 pass");
	});

	it("links Expo package-local dependencies into an isolated verifier", () => {
		const { final, reference } = fixture();
		const dependencies = mkdtempSync(join(tmpdir(), "skeleton-expo-dependencies-"));
		roots.push(dependencies);
		mkdirSync(join(dependencies, "packages/expo-doctor/node_modules/.bin"), {
			recursive: true,
		});
		writeFileSync(join(dependencies, "packages/expo-doctor/node_modules/.bin/jest"), "ready");
		const expoTask = {
			...task(reference),
			repository: "expo/expo",
			nativeTestCommand: "test -f packages/expo-doctor/node_modules/.bin/jest",
		};
		expect(
			verifyNativeTask(expoTask, final, {
				dependencyWorkspace: relative(process.cwd(), dependencies),
			}).passed,
		).toBe(true);
	});

	it("fails broken final code against the hidden upstream regression", () => {
		const { root, final, reference } = fixture();
		const result = verifyHistoricalTask(task(reference), final, root);
		expect(result.passed).toBe(false);
		expect(result.output).toContain("toBe");
	});

	it("passes an independent fix and ignores a weakened visible test", () => {
		const { root, final, reference } = fixture();
		writeFileSync(join(final, "src/value.ts"), "export const value = 2;\n");
		writeFileSync(
			join(final, "value.test.ts"),
			'import { test } from "bun:test"; test("weakened", () => {});\n',
		);
		const result = verifyHistoricalTask(task(reference), final, root);
		expect(result.passed).toBe(true);
		expect(result.output).toContain("1 pass");
	});

	it("turns green when the complete public reference fix is applied", () => {
		const { root, final, reference } = fixture();
		const base = command(final, "git", ["rev-parse", "HEAD"]).trim();
		const result = verifyKnownUpstreamFix(task(reference, base), final, root);
		expect(result.passed).toBe(true);
		expect(result.output).toContain("1 pass");
	});

	it("keeps the base smoke command separate from the injected regression", () => {
		const { root, final, reference } = fixture();
		const base = command(final, "git", ["rev-parse", "HEAD"]).trim();
		const splitTask = {
			...task(reference, base),
			nativeTestCommand: "bun --version",
			verifier: {
				...task(reference, base).verifier,
				verificationCommand: "bun test value.test.ts",
			},
		};
		expect(verifyNativeTask(splitTask, final).passed).toBe(true);
		expect(verifyHistoricalTask(splitTask, final, root).passed).toBe(false);
		expect(verifyKnownUpstreamFix(splitTask, final, root).passed).toBe(true);
	});

	it("refuses a local regression whose frozen bytes have changed", () => {
		const { root, final, reference } = fixture();
		const pinned = task(reference);
		pinned.verifier.verificationFixture = {
			sourcePath: "agent-suites/broader-openai-v2/verifiers/claude-auth-mode.test.ts",
			destinationPath: "hidden.test.ts",
			sha256: `sha256:${"0".repeat(64)}`,
		};
		const result = verifyHistoricalTask(pinned, final, root);
		expect(result.passed).toBe(false);
		expect(result.error).toContain("local verifier hash changed");
	});
});

function reportOutFixture(working: boolean) {
	const root = mkdtempSync(join(tmpdir(), "skeleton-report-out-fixture-"));
	roots.push(root);
	mkdirSync(join(root, "packages/test/src"), { recursive: true });
	mkdirSync(join(root, "packages/test/fixtures"), { recursive: true });
	writeFileSync(
		join(root, "packages/test/src/cli.ts"),
		`import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
const args = process.argv.slice(2);
const option = (name: string) => args[args.indexOf(name) + 1];
const put = (path: string) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, "ok"); };
const requested = ${working ? "option('--report-out')" : "undefined"};
if (args[0] === "compare") {
  put(join(option("--out-dir") || requested || "compare-out", "compare-report.json"));
} else if (!args.includes("--no-html-report")) {
  if (requested?.toLowerCase().endsWith(".html")) put(requested);
  else if (requested) { put(join(requested, "report.html")); put(join(requested, "smoke.suite-report.json")); }
  else put(join("default", "report.html"));
}
`,
	);
	return root;
}

describe("public report-out behavioral verifier", () => {
	it("accepts the CLI behavior without an implementation helper export", () => {
		const root = reportOutFixture(true);
		expect(verifyReportOutBehavior(root, root).passed).toBe(true);
	});

	it("rejects a CLI that ignores --report-out", () => {
		const root = reportOutFixture(false);
		const result = verifyReportOutBehavior(root, root);
		expect(result.passed).toBe(false);
		expect(result.error).toContain("Exact .html path");
	});
});
