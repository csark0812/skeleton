import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import type { Workspace } from "@post-print/agent-test";

/** Stage the same source patch in each fresh task, before its initial snapshot. */
export function stageBillingChange(workspace: Workspace): void {
	const patch = fileURLToPath(
		new URL("../../agent-suites/seeds/billing-v2.patch", import.meta.url),
	);
	execFileSync("git", ["apply", "--index", patch], { cwd: workspace.path });
}
