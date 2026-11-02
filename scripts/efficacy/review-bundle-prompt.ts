import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Workspace } from "@post-print/agent-test";
import type { ReviewScenario } from "./review-scenarios.ts";

const FIXTURES = fileURLToPath(new URL("../../tests/fixtures/efficacy/", import.meta.url));

/** The task line before the bundle. The bundle's own contract sets the report format. */
export const BUNDLE_PROMPT_LEAD =
	"Review the feature branch against main. Report only; do not modify files. The review bundle follows.";

/** Build the Skeleton workspace the way the harness does: copy, commit on main, then seed. */
function seededSkeletonWorkspace(scenario: ReviewScenario): string {
	const root = mkdtempSync(join(tmpdir(), `skeleton-review-bundle-${scenario.name}-`));
	cpSync(join(FIXTURES, scenario.fixture, "skeleton"), root, { recursive: true });
	const git = (...args: string[]) => execFileSync("git", args, { cwd: root });
	git("init", "-q", "-b", "main");
	git("config", "user.email", "harness@local");
	git("config", "user.name", "agent-harness");
	git("add", "-A");
	git("commit", "-q", "-m", "sealed workspace");
	scenario.seed({ path: root } as Workspace, "skeleton");
	return root;
}

/**
 * The reviewer prompt Skeleton documents: the printed bundle given to a fresh session. The
 * seeded change is fixed, so one bundle serves every run of the scenario.
 */
export function reviewBundlePrompt(scenario: ReviewScenario): string {
	const root = seededSkeletonWorkspace(scenario);
	try {
		const bundle = execFileSync(
			"npx",
			["--no-install", "skeleton", "review", "prepare", "--base", "main"],
			{
				cwd: root,
				encoding: "utf8",
				maxBuffer: 64 * 1024 * 1024,
				stdio: ["ignore", "pipe", "pipe"],
			},
		);
		return `${BUNDLE_PROMPT_LEAD}\n\n${bundle}`;
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
}
