import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Workspace } from "@post-print/agent-test";

/** Stage the same source patch in each fresh task, before its initial snapshot. */
export function stageBillingChange(workspace: Workspace): void {
	const patch = fileURLToPath(
		new URL("../../agent-suites/seeds/billing-v2.patch", import.meta.url),
	);
	execFileSync("git", ["apply", "--index", patch], { cwd: workspace.path });
}

/** The author's claim for the seeded review change; it denies the refund change the patch makes. */
export const REVIEW_CHANGE_MESSAGE = `Retry charges three times and add saved-card charging

Retries failed charges up to three times, adds chargeSavedCard, tidies the order
helpers, and simplifies the payout route. Refund behavior is unchanged.`;

/** Commit the seeded defects on a feature branch in each fresh task, before its initial snapshot. */
export function seedReviewChange(workspace: Workspace): void {
	const patch = fileURLToPath(
		new URL("../../agent-suites/seeds/review-change.patch", import.meta.url),
	);
	const git = (...args: string[]) => execFileSync("git", args, { cwd: workspace.path });
	git("checkout", "-q", "-b", "feature");
	git("apply", "--index", patch);
	git("commit", "-q", "-m", REVIEW_CHANGE_MESSAGE);
}

/** Install the hook that `skeleton init` asks consumers to enable with `pre-commit install`. */
export function installSkeletonPreCommitHook(workspace: Workspace): void {
	const hooks = execFileSync("git", ["rev-parse", "--git-path", "hooks"], {
		cwd: workspace.path,
		encoding: "utf8",
	}).trim();
	mkdirSync(join(workspace.path, hooks), { recursive: true });
	writeFileSync(
		join(workspace.path, hooks, "pre-commit"),
		"#!/bin/sh\nexec node node_modules/@csark0812/skeleton/dist/cli.js validate changed --staged\n",
		{ mode: 0o755 },
	);
}
