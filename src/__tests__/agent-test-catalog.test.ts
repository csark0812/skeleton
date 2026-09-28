import { expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import process from "node:process";

const ROOT = join(import.meta.dir, "../..");
const PLAYWRIGHT_CLI = "node_modules/@playwright/test/cli.js";

test("agent-test catalog uses logical suites without a repeated default-project label", () => {
	const output = execFileSync(
		process.execPath,
		[PLAYWRIGHT_CLI, "test", "--config=agent-test.config.ts", "--list"],
		{ cwd: ROOT, encoding: "utf8" },
	);
	const suiteCounts = new Map<string, number>();
	for (const line of output.split("\n")) {
		if (!line.includes(" › ")) continue;
		const parts = line.trim().split(" › ");
		if (parts.length < 3) continue;
		const suite = parts.slice(parts[0]?.startsWith("[") ? 2 : 1, -1).join(" › ");
		suiteCounts.set(suite, (suiteCounts.get(suite) ?? 0) + 1);
	}

	expect(output).not.toContain("[openai]");
	expect(output).not.toContain("Public polyglot OpenAI qualification");
	expect(Object.fromEntries(suiteCounts)).toEqual({
		"Does Skeleton help?": 10,
		"Documentation judge calibration": 2,
		"Install the published package": 1,
		"Document authority": 2,
	});
});

test("offline contracts discover only the bounded suite directory", () => {
	const output = execFileSync(
		process.execPath,
		[PLAYWRIGHT_CLI, "test", "--config=agent-test.offline.config.ts", "--list"],
		{ cwd: ROOT, encoding: "utf8", timeout: 10_000 },
	);
	expect(output).toContain("Total: 9 tests in 1 file");
	expect(output).toContain("Offline v2 migration contracts");
});

test("the optional host matrix excludes retired and explicit-only suites", () => {
	const output = execFileSync(
		process.execPath,
		[PLAYWRIGHT_CLI, "test", "--config=agent-test.matrix.config.ts", "--list"],
		{ cwd: ROOT, encoding: "utf8", timeout: 10_000 },
	);
	expect(output).toContain("Total: 41 tests in 1 file");
	expect(output).not.toContain("Public regression pilot");
	expect(output).not.toContain("Public polyglot OpenAI qualification");
	expect(output).not.toContain("Offline v2 migration contracts");
});
