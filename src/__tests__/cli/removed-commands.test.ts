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

	it("rejects attest with migration text, since nothing records reviews", () => {
		const result = runCli(["attest", "docs/a.md"]);
		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain("attest: removed in Skeleton 9");
		expect(result.stderr).toContain("delete .skeleton/review-lock.toml");
	});

	it("does not treat hook as a command", () => {
		const result = runCli(["hook"]);
		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain("Usage: skeleton");
		expect(result.stderr).not.toContain("hook: removed");
	});
});
