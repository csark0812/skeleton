import { describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

const HOOK = join(import.meta.dir, "../../hooks/customize-on-skill-read.ts");
const POSTPRINT = join(import.meta.dir, "../../audit/__tests__/fixtures/postprint-repo");

function runHook(stdin: string): { stdout: string; exitCode: number | null } {
	const proc = spawnSync("bun", [HOOK], {
		cwd: POSTPRINT,
		input: stdin,
		encoding: "utf8",
	});
	return { stdout: proc.stdout, exitCode: proc.status };
}

describe("customize-on-skill-read hook", () => {
	it("returns noop for non-SKILL.md Read", () => {
		const { stdout, exitCode } = runHook(
			JSON.stringify({
				tool_name: "Read",
				tool_input: { path: "/repo/docs/README.md" },
			}),
		);
		expect(exitCode).toBe(0);
		expect(stdout.trim()).toBe("{}");
	});

	it("injects customize content for SKILL.md Read (Cursor)", () => {
		const skillPath = join(POSTPRINT, ".claude/skills/code-review/SKILL.md");
		const { stdout, exitCode } = runHook(
			JSON.stringify({
				tool_name: "Read",
				hook_event_name: "postToolUse",
				tool_input: { path: skillPath },
			}),
		);
		expect(exitCode).toBe(0);
		const parsed = JSON.parse(stdout);
		expect(parsed.additional_context).toContain("PostPrint code review");
	});

	it("injects customize content for Skill tool (Claude)", () => {
		const { stdout, exitCode } = runHook(
			JSON.stringify({
				tool_name: "Skill",
				tool_input: { skill: "code-review" },
			}),
		);
		expect(exitCode).toBe(0);
		const parsed = JSON.parse(stdout);
		expect(parsed.hookSpecificOutput.additionalContext).toContain("PostPrint code review");
	});

	it("returns noop when no customize override", () => {
		const { stdout, exitCode } = runHook(
			JSON.stringify({
				tool_name: "Skill",
				tool_input: { skill: "missing" },
			}),
		);
		expect(exitCode).toBe(0);
		expect(stdout.trim()).toBe("{}");
	});
});
