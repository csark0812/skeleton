import { afterEach, describe, expect, it } from "bun:test";
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { QualificationCorpusTask } from "../../scripts/efficacy/corpus.ts";
import {
	verifyHistoricalTask,
	verifyKnownUpstreamFix,
	verifyNativeTask,
} from "../../scripts/efficacy/public-verification.ts";

const roots: string[] = [];
afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
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
});
