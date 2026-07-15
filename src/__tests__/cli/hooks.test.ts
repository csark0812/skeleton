import { describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

const HOOK = join(import.meta.dir, "../../hooks/customize-on-skill-read.ts");
const CLI = join(import.meta.dir, "../../cli.ts");
const NESTED_SKILLS_CUSTOMIZE = join(
	import.meta.dir,
	"../../audit/__tests__/fixtures/nested-skills-customize",
);

// The standalone entrypoint and `skeleton hook customize` share one implementation,
// so exercise both to guarantee parity.
const ENTRYPOINTS: Array<{ name: string; argv: string[] }> = [
	{ name: "customize-on-skill-read hook", argv: [HOOK] },
	{ name: "skeleton hook customize", argv: [CLI, "hook", "customize"] },
];

function runHook(argv: string[], stdin: string): { stdout: string; exitCode: number | null } {
	const proc = spawnSync("bun", argv, {
		cwd: NESTED_SKILLS_CUSTOMIZE,
		input: stdin,
		encoding: "utf8",
	});
	return { stdout: proc.stdout, exitCode: proc.status };
}

describe.each(ENTRYPOINTS)("$name", ({ argv }) => {
	const runHookEntry = (stdin: string) => runHook(argv, stdin);

	it("returns noop for non-skill Read", () => {
		const { stdout, exitCode } = runHookEntry(
			JSON.stringify({
				tool_name: "Read",
				tool_input: { path: "/repo/docs/README.md" },
			}),
		);
		expect(exitCode).toBe(0);
		expect(stdout.trim()).toBe("{}");
	});

	it("injects customize content for skill-tree references Read", () => {
		const refPath = join(
			NESTED_SKILLS_CUSTOMIZE,
			".claude/skills/code-review/references/planning/build.md",
		);
		const { stdout, exitCode } = runHookEntry(
			JSON.stringify({
				tool_name: "Read",
				hook_event_name: "postToolUse",
				tool_input: { path: refPath },
			}),
		);
		expect(exitCode).toBe(0);
		const parsed = JSON.parse(stdout);
		expect(parsed.additional_context).toContain("Code review customize");
	});

	it("injects customize content for SKILL.md Read (Cursor)", () => {
		const skillPath = join(NESTED_SKILLS_CUSTOMIZE, ".claude/skills/code-review/SKILL.md");
		const { stdout, exitCode } = runHookEntry(
			JSON.stringify({
				tool_name: "Read",
				hook_event_name: "postToolUse",
				tool_input: { path: skillPath },
			}),
		);
		expect(exitCode).toBe(0);
		const parsed = JSON.parse(stdout);
		expect(parsed.additional_context).toContain("Code review customize");
	});

	it("injects customize content for Skill tool (Claude)", () => {
		const { stdout, exitCode } = runHookEntry(
			JSON.stringify({
				tool_name: "Skill",
				tool_input: { skill: "code-review" },
			}),
		);
		expect(exitCode).toBe(0);
		const parsed = JSON.parse(stdout);
		expect(parsed.hookSpecificOutput.additionalContext).toContain("Code review customize");
	});

	it("returns noop when no customize override", () => {
		const { stdout, exitCode } = runHookEntry(
			JSON.stringify({
				tool_name: "Skill",
				tool_input: { skill: "missing" },
			}),
		);
		expect(exitCode).toBe(0);
		expect(stdout.trim()).toBe("{}");
	});
});
