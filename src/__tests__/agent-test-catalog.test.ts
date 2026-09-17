import { expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import process from "node:process";

const ROOT = join(import.meta.dir, "../..");

test("agent-test catalog uses logical suites without a repeated default-project label", () => {
	const output = execFileSync(
		process.execPath,
		["node_modules/@post-print/agent-test/dist/cli.js", "test", "--list"],
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
	expect(Object.fromEntries(suiteCounts)).toEqual({
		"Does Skeleton help?": 9,
		"Documentation judge calibration": 2,
		"Install the published package": 1,
		"Document authority": 2,
	});
});
