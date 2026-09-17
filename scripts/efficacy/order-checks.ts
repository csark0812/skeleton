import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Run } from "@post-print/agent-test";

/** Check public behavior with tests outside the agent's control. */
export function checkOrderLimits(run: Pick<Run, "workspace">) {
	if (!existsSync(run.workspace.final.path)) throw new Error("Final snapshot is unavailable.");
	if (!existsSync(join(run.workspace.final.path, "src")))
		return { passed: false, output: "Required src directory is missing from the final result." };
	const root = mkdtempSync(join(tmpdir(), "skeleton-order-check-"));
	try {
		cpSync(join(run.workspace.final.path, "src"), join(root, "src"), { recursive: true });
		writeFileSync(
			join(root, "acceptance.test.ts"),
			`import { expect, test } from "bun:test";
import { orderLimit } from "./src/checkout.ts";
test("preserves special and fallback limits", () => {
 expect(orderLimit("standard")).toBe(30);
 expect(orderLimit("regulated")).toBe(5);
 expect(orderLimit("unknown")).toBe(20);
});`,
		);
		const result = spawnSync("bun", ["test", "acceptance.test.ts"], {
			cwd: root,
			encoding: "utf8",
			timeout: 60_000,
		});
		if (result.error || result.signal)
			throw new Error(result.error?.message ?? `Checker ended with ${result.signal}`);
		return { passed: result.status === 0, output: `${result.stdout}${result.stderr}` };
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
}
