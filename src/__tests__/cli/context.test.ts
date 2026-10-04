import { afterEach, describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";

const CLI = join(import.meta.dir, "../../cli.ts");
let roots: string[] = [];

function makeRoot(): string {
	const root = mkdtempSync(join(tmpdir(), "skel-context-cli-"));
	roots.push(root);
	mkdirSync(join(root, "docs"), { recursive: true });
	mkdirSync(join(root, "src"), { recursive: true });
	mkdirSync(join(root, "tests"), { recursive: true });
	writeFileSync(
		join(root, "skeleton.toml"),
		'daysUntilStale = 365\n[scan]\ninclude = ["docs/**"]\nexclude = []\n',
	);
	writeFileSync(
		join(root, "package.json"),
		'{"private":true,"scripts":{"test":"bun test ./src"}}\n',
	);
	writeFileSync(join(root, "src/billing.ts"), "export const RETRIES = 1;\n");
	writeFileSync(
		join(root, "tests/billing.test.ts"),
		'import { RETRIES } from "../src/billing";\ntest("retries", () => expect(RETRIES).toBe(1));\n',
	);
	writeFileSync(
		join(root, "docs/billing.md"),
		"<!-- source-of-truth: Billing retry policy -->\n\n<!-- review-deps: paths=src/billing.ts -->\n\nBilling retries once.\n",
	);
	return root;
}

function run(root: string, args: string[]) {
	return spawnSync("bun", [CLI, "context", ...args], {
		cwd: root,
		encoding: "utf8",
		env: process.env,
	});
}

afterEach(() => {
	for (const root of roots) rmSync(root, { recursive: true, force: true });
	roots = [];
});

describe("context CLI", () => {
	it("drains a large Node context packet through a pipe before exiting", () => {
		const root = makeRoot();
		for (let index = 0; index < 90; index++) {
			writeFileSync(
				join(root, `docs/policy-${String(index).padStart(3, "0")}.md`),
				`<!-- source-of-truth: Billing policy ${index} -->\n${"Billing policy evidence.\n".repeat(60)}`,
			);
		}
		mkdirSync(join(root, "dist"));
		cpSync(join(import.meta.dir, "../../../templates"), join(root, "templates"), {
			recursive: true,
		});
		cpSync(join(import.meta.dir, "../../../schemas"), join(root, "schemas"), { recursive: true });
		const bundledCli = join(root, "dist/cli.mjs");
		const build = spawnSync("bun", ["build", CLI, "--target=node", `--outfile=${bundledCli}`], {
			cwd: root,
			encoding: "utf8",
		});
		expect(build.status).toBe(0);
		const result = spawnSync(
			"node",
			[bundledCli, "context", "billing policy", "--max-chars=200000"],
			{ cwd: root, encoding: "utf8", maxBuffer: 1_000_000 },
		);
		expect(result.stderr).toBe("");
		expect(result.status).toBe(0);
		expect(result.stdout.length).toBeGreaterThan(65_536);
		expect(result.stdout).toContain("document\tdocs/policy-089.md\tunreviewed");
		const reference = run(root, ["billing policy", "--max-chars=200000"]);
		expect(reference.status).toBe(0);
		expect(result.stdout).toBe(reference.stdout);
	});

	it("prints an owning document and source for a source path", () => {
		const result = run(makeRoot(), ["--path", "src/billing.ts"]);
		expect(result.status).toBe(0);
		expect(result.stdout).toContain("document\tdocs/billing.md\tunreviewed");
		expect(result.stdout).toContain("source\tsrc/billing.ts");
		expect(result.stdout).toContain("test\ttests/billing.test.ts");
		expect(result.stdout).toContain("test-command\tbun test tests/billing.test.ts");
	});

	it("rejects a query and path together", () => {
		const result = run(makeRoot(), ["billing", "--path", "src/billing.ts"]);
		expect(result.status).toBe(1);
		expect(result.stderr).toContain("context: provide a query or --path <path>, not both");
	});

	it("makes an unresolved source path explicit", () => {
		const result = run(makeRoot(), ["--path", "src/missing.ts"]);
		expect(result.status).toBe(0);
		expect(result.stdout).toContain("no-context\tno canonical document matched\n");
		expect(result.stdout).toContain("action\tno-context\tInspect the relevant code");
		expect(result.stdout).toContain("A --path miss must gain an owning document.");
		expect(result.stdout).toContain("Rerun this exact context request");
	});

	it("offers the same recovery action for an unmatched topic query", () => {
		const result = run(makeRoot(), ["unrelated topic"]);
		expect(result.status).toBe(0);
		expect(result.stdout).toContain("no-context\tno canonical document matched\n");
		expect(result.stdout).toContain("durable behavior");
		expect(result.stdout).toContain("For a read-only task, report the gap");
	});

	it("keeps successful context output free of the no-context action", () => {
		const result = run(makeRoot(), ["billing retry"]);
		expect(result.status).toBe(0);
		expect(result.stdout).toContain("document\tdocs/billing.md\tunreviewed");
		expect(result.stdout).not.toContain("action\tno-context");
	});

	it("makes changed source values authoritative over stale document claims", () => {
		const root = makeRoot();
		const document =
			"<!-- source-of-truth: Billing retry policy -->\n\n<!-- review-deps: paths=src/billing.ts -->\n\nBilling retries once.\n";
		mkdirSync(join(root, ".skeleton"), { recursive: true });
		writeFileSync(
			join(root, ".skeleton/review-lock.json"),
			JSON.stringify({
				documents: {
					"docs/billing.md": {
						documentHash: `sha256:${createHash("sha256").update(document).digest("hex")}`,
						reviewDependencies: { "src/billing.ts": "sha256:stale" },
					},
				},
			}),
		);
		const result = run(root, ["billing retry"]);
		expect(result.status).toBe(0);
		expect(result.stdout).toContain(
			"action\tdocs/billing.md\tReturned source excerpts are authoritative",
		);
		expect(result.stdout).toContain("never copy a stale document value over a source value");
		expect(result.stdout).toContain("stale-document\tdocs/billing.md");
		expect(result.stdout.indexOf("source\tsrc/billing.ts")).toBeLessThan(
			result.stdout.indexOf("stale-document\tdocs/billing.md"),
		);
	});

	it("returns separated relevant source regions in one context packet", () => {
		const root = makeRoot();
		writeFileSync(
			join(root, "docs/billing.md"),
			"<!-- source-of-truth: Coverage candidate and uncovered diagnostics -->\n\n<!-- review-deps: paths=src/billing.ts -->\n",
		);
		writeFileSync(
			join(root, "src/billing.ts"),
			[
				"export function coverageCandidateCount(paths: string[]) {",
				"\treturn paths.filter((path) => path.endsWith('.ts')).length;",
				"}",
				...Array.from({ length: 240 }, (_, index) => `// unrelated implementation ${index}`),
				"export function uncoveredChangedPathDiagnostics(paths: string[]) {",
				"\treturn paths.filter((path) => path.includes('uncovered'));",
				"}",
			].join("\n"),
		);
		const result = run(root, ["coverage candidate count uncovered changed path diagnostics"]);
		expect(result.status).toBe(0);
		expect(result.stdout).toContain("coverageCandidateCount");
		expect(result.stdout).toContain("uncoveredChangedPathDiagnostics");
	});

	it("prefers the test named for the owned source over a broad integration test", () => {
		const root = makeRoot();
		writeFileSync(join(root, "src/review-coverage.ts"), "export const coverage = true;\n");
		writeFileSync(
			join(root, "docs/billing.md"),
			"<!-- source-of-truth: Review coverage policy -->\n\n<!-- review-deps: paths=src/review-coverage.ts -->\n",
		);
		writeFileSync(
			join(root, "tests/validate.test.ts"),
			"// review coverage review coverage review coverage review coverage\n",
		);
		writeFileSync(
			join(root, "tests/review-coverage.test.ts"),
			'import { coverage } from "../src/review-coverage";\ntest("coverage", () => expect(coverage).toBe(true));\n',
		);
		const result = run(root, ["review coverage"]);
		expect(result.status).toBe(0);
		expect(result.stdout).toContain("test\ttests/review-coverage.test.ts");
		expect(result.stdout).not.toContain("test\ttests/validate.test.ts");
	});
});
