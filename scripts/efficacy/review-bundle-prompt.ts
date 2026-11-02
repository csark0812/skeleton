import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
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
	// A detached auto-gc after the large `real` commit would still be writing when cleanup runs.
	git("config", "gc.auto", "0");
	git("config", "maintenance.auto", "false");
	git("add", "-A");
	git("commit", "-q", "-m", "sealed workspace");
	scenario.seed({ path: root } as Workspace, "skeleton");
	return root;
}

/** Bundle sections a removal test may take out, by the environment's `SKELETON_REVIEW_REMOVE`. */
const REMOVABLE_SECTIONS: Record<string, string> = {
	documents: "Documents the author must re-read and update",
	intent: "Stated intent",
};

/** Take one `## ` section out of a bundle, to test what that section does to reviewers. */
export function withoutSection(bundle: string, removal: string): string {
	const heading = REMOVABLE_SECTIONS[removal];
	if (!heading) throw new Error(`Unknown section to remove: ${removal}`);
	const start = bundle.indexOf(`\n## ${heading}\n`);
	if (start < 0) throw new Error(`The bundle has no "${heading}" section to remove.`);
	const end = bundle.indexOf("\n## ", start + 1);
	return bundle.slice(0, start) + (end < 0 ? "\n" : bundle.slice(end));
}

/**
 * The reviewer prompt Skeleton documents: the printed bundle given to a fresh session. The
 * seeded change is fixed, so one bundle serves every run of the scenario.
 */
export function reviewBundlePrompt(
	scenario: ReviewScenario,
	removal = process.env.SKELETON_REVIEW_REMOVE ?? "",
): string {
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
		return `${BUNDLE_PROMPT_LEAD}\n\n${removal ? withoutSection(bundle, removal) : bundle}`;
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
}
