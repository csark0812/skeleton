import { afterEach, describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
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
	it("prints an owning document and source for a source path", () => {
		const result = run(makeRoot(), ["--path", "src/billing.ts"]);
		expect(result.status).toBe(0);
		expect(result.stdout).toContain("document\tdocs/billing.md\tunreviewed");
		expect(result.stdout).toContain("source\tsrc/billing.ts");
		expect(result.stdout).toContain("test\ttests/billing.test.ts");
	});

	it("rejects a query and path together", () => {
		const result = run(makeRoot(), ["billing", "--path", "src/billing.ts"]);
		expect(result.status).toBe(1);
		expect(result.stderr).toContain("context: provide a query or --path <path>, not both");
	});

	it("makes an unresolved source path explicit", () => {
		const result = run(makeRoot(), ["--path", "src/missing.ts"]);
		expect(result.status).toBe(0);
		expect(result.stdout).toBe("no-context\tno canonical document matched\n");
	});
});
