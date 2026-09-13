import { describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

const CLI = join(import.meta.dir, "../../cli.ts");

function runCli(args: string[]): { stderr: string; exitCode: number | null } {
	const proc = spawnSync("bun", [CLI, ...args], { encoding: "utf8" });
	return { stderr: proc.stderr, exitCode: proc.status };
}

describe("removed overlay commands", () => {
	it("rejects customize with migration text", () => {
		const result = runCli(["customize", "resolve", "code-review"]);
		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain("customize: removed");
	});

	it("rejects hook with migration text", () => {
		const result = runCli(["hook", "customize"]);
		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain("hook: removed");
	});
});
