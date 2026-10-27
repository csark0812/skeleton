import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import type { Workspace } from "@post-print/agent-test";
import { createContext } from "../../src/audit/core/context.ts";
import { attestDocuments } from "../../src/audit/core/review-proof.ts";

/** Stage the same source patch in each fresh task, before its initial snapshot. */
export function stageBillingChange(workspace: Workspace): void {
	const patch = fileURLToPath(
		new URL("../../agent-suites/seeds/billing-v2.patch", import.meta.url),
	);
	execFileSync("git", ["apply", "--index", patch], { cwd: workspace.path });
}

/**
 * Review proof lives in commit history, and each task starts from a fresh one-commit
 * repository, so record the fixture's baseline reviews as an attest commit before the task.
 * Run it before any setup that changes files: a review binds committed bytes.
 */
export function recordFixtureReviews(workspace: Workspace): void {
	const documents = createContext({ root: workspace.path }).docMetaPaths;
	if (documents.length > 0) attestDocuments({ root: workspace.path, paths: documents });
}
