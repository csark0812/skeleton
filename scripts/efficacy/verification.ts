import { spawnSync } from "node:child_process";
import {
	cpSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { HISTORY_TASKS } from "./history.ts";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const RETRY_TEST = `import { expect, test } from "bun:test";
import { deliverBillingWebhook, WEBHOOK_URL } from "./src/billing.ts";
test("preserves endpoint", () => expect(WEBHOOK_URL).toBe("https://api.example.com/v2/billing/webhook"));
for (const [responses, expected, calls] of [[[true], true, 1], [[false, true], true, 2], [[false, false, true], false, 2]]) {
 test(JSON.stringify(responses), async () => {
  let count = 0;
  const result = await deliverBillingWebhook(async () => responses[count++]);
  expect(result).toBe(expected); expect(count).toBe(calls);
 });
}
`;

const DELETED_FILE_COVERAGE_TEST = `import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { evaluateValidateChanged } from "./src/validate/changed.ts";

function git(root, args) {
 const result = spawnSync("git", args, {
  cwd: root,
  encoding: "utf8",
  env: { ...process.env, GIT_AUTHOR_NAME: "Test", GIT_AUTHOR_EMAIL: "test@example.com", GIT_COMMITTER_NAME: "Test", GIT_COMMITTER_EMAIL: "test@example.com" },
 });
 if (result.status !== 0) throw new Error(result.stderr || result.stdout);
}

test("deleted coverage paths do not suppress the skipped-path diagnostic", async () => {
 const root = mkdtempSync(join(tmpdir(), "skeleton-deleted-count-"));
 try {
  writeFileSync(join(root, "skeleton.toml"), 'daysUntilStale = 365\\n[scan]\\ninclude = ["docs/**"]\\nexclude = []\\n');
  mkdirSync(join(root, "src"), { recursive: true });
  writeFileSync(join(root, "src/gone.ts"), "export const gone = 1;\\n");
  writeFileSync(join(root, "notes.txt"), "before\\n");
  git(root, ["init"]); git(root, ["add", "-A"]); git(root, ["commit", "-m", "init"]);
  git(root, ["rm", "src/gone.ts"]);
  writeFileSync(join(root, "notes.txt"), "after\\n");
  const result = await evaluateValidateChanged({ root });
  expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: "all-paths-skipped" }));
  expect(result.diagnostics).not.toContainEqual(expect.objectContaining({ code: "uncovered-changed-path", file: "src/gone.ts" }));
 } finally {
  rmSync(root, { recursive: true, force: true });
 }
});
`;

/** Run trusted checks in a disposable copy; do not alter the agent's files or count this as agent work. */
export function verifyCode(
	taskName: string,
	workspace: string,
): { passed: boolean; output: string; error?: string } | undefined {
	const history = HISTORY_TASKS.find((task) => taskName === task.scenario);
	if (!history && taskName !== "change-code-without-doc-reminder") return;
	if (!existsSync(workspace))
		return {
			passed: false,
			output: "Final snapshot is unavailable.",
			error: "Final snapshot is unavailable.",
		};
	if (!existsSync(join(workspace, "src")))
		return { passed: false, output: "Required src directory is missing from the final result." };
	const temp = mkdtempSync(join(tmpdir(), "skeleton-result-check-"));
	try {
		cpSync(join(workspace, "src"), join(temp, "src"), { recursive: true });
		let paths = ["acceptance.test.ts"];
		if (history) paths = prepareHistoricalCheck(history, temp);
		else writeFileSync(join(temp, paths[0]), RETRY_TEST);
		const result = spawnSync("bun", ["test", ...paths], {
			cwd: temp,
			encoding: "utf8",
			timeout: 60_000,
		});
		return regressionResult(result);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return { passed: false, output: message, error: message };
	} finally {
		rmSync(temp, { recursive: true, force: true });
	}
}

function prepareHistoricalCheck(history: (typeof HISTORY_TASKS)[number], temp: string): string[] {
	const baseline = join(ROOT, "tests/fixtures/efficacy/history", history.name, "control");
	for (const directory of ["schemas", "node_modules"])
		cpSync(join(baseline, directory), join(temp, directory), { recursive: true });
	for (const path of history.tests) {
		mkdirSync(dirname(join(temp, path)), { recursive: true });
		writeFileSync(join(temp, path), readFileSync(join(baseline, path)));
	}
	if (history.name === "deleted-file") {
		const externalTest = "deleted-file-coverage.acceptance.test.ts";
		writeFileSync(join(temp, externalTest), DELETED_FILE_COVERAGE_TEST);
		return [...history.tests, externalTest];
	}
	return [...history.tests];
}

function regressionResult(result: ReturnType<typeof spawnSync>) {
	const error =
		result.error?.message ??
		(result.signal ? `Regression process ended with ${result.signal}` : undefined);
	return {
		passed: result.status === 0,
		output: `${result.stdout}${result.stderr}${error ?? ""}`,
		error,
	};
}
