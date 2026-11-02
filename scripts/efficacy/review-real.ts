import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Workspace } from "@post-print/agent-test";

const REPOSITORY = fileURLToPath(new URL("../..", import.meta.url));
/** A real fix in this repository, and the message of the commit that reverts it. */
type RealRegression = { fixCommit: string; fixPaths: string[]; message: string };

/** Release version bumps stopped invalidating document review. The review contract was tuned here. */
const PACKAGE_VERSION_REGRESSION: RealRegression = {
	fixCommit: "7a605f2",
	fixPaths: [
		"src/audit/core/review-proof.ts",
		"src/context.ts",
		"src/audit/__tests__/review-proof.test.ts",
		"src/__tests__/context.test.ts",
	],
	message: `Hash every review dependency the same way

Removes the special handling of package.json so every dependency digest is computed
from the file's bytes.`,
};

/**
 * `--base` review dates stopped depending on the clock. Held out: chosen by a fixed rule and never
 * used to tune the contract.
 */
const UTC_MIDNIGHT_REGRESSION: RealRegression = {
	fixCommit: "eb85023",
	fixPaths: [
		"src/validate/changed.ts",
		"src/validate/git-diff.ts",
		"src/__tests__/cli/validate-hook.test.ts",
	],
	message: `Check review dates against today's UTC date everywhere

Drops the per-range commit lookup, so date-mode review in validate changed compares
last-reviewed with today's UTC date under --base too, the same as local runs.`,
};

const SKELETON_MARKERS = /<!--\s*(?:source-of-truth|doc-meta|review-deps)[^>]*-->\n*/g;

function markdownFiles(root: string, directory = root): string[] {
	return readdirSync(directory).flatMap((name) => {
		if (name === ".git" || name === "node_modules") return [];
		const path = join(directory, name);
		if (statSync(path).isDirectory()) return markdownFiles(root, path);
		return name.endsWith(".md") ? [path] : [];
	});
}

/** The bare-diff side keeps the same prose and code without anything Skeleton reads. */
function removeSkeletonMetadata(root: string): void {
	for (const path of ["skeleton.toml", ".skeleton"])
		rmSync(join(root, path), { recursive: true, force: true });
	for (const path of markdownFiles(root))
		writeFileSync(path, readFileSync(path, "utf8").replace(SKELETON_MARKERS, ""));
}

/** The snapshot predates the removal of `[reviewProof]`, which the packed package now rejects. */
function adoptCurrentConfigSchema(root: string): void {
	const path = join(root, "skeleton.toml");
	writeFileSync(path, readFileSync(path, "utf8").replace(/\[reviewProof\]\nmode = "hash"\n\n/, ""));
}

/**
 * The snapshot is Skeleton's own package, and a package that declares the `skeleton` bin makes
 * `npx --no-install skeleton` reach for npm's cache, which the sandbox forbids. No bundle arrives.
 */
function removeOwnBin(root: string): void {
	const path = join(root, "package.json");
	const { bin: _bin, ...manifest } = JSON.parse(readFileSync(path, "utf8"));
	writeFileSync(path, `${JSON.stringify(manifest, null, "\t")}\n`);
}

/** Extract the repository at a real fix, then commit that fix's reversal on a feature branch. */
function seedRealRegression(regression: RealRegression) {
	return (workspace: Workspace, arm: "control" | "skeleton"): void => {
		const root = workspace.path;
		const git = (...args: string[]) => execFileSync("git", args, { cwd: root });
		const archive = execFileSync("git", ["archive", regression.fixCommit], {
			cwd: REPOSITORY,
			maxBuffer: 256 * 1024 * 1024,
		});
		execFileSync("tar", ["-x", "-C", root], { input: archive });
		removeOwnBin(root);
		if (arm === "skeleton") adoptCurrentConfigSchema(root);
		else removeSkeletonMetadata(root);
		git("add", "-A");
		git("commit", "-q", "-m", "Snapshot before the change");
		git("checkout", "-q", "-b", "feature");
		const fix = execFileSync(
			"git",
			["show", "--format=", regression.fixCommit, "--", ...regression.fixPaths],
			{ cwd: REPOSITORY, maxBuffer: 64 * 1024 * 1024 },
		);
		execFileSync("git", ["apply", "-R", "--index"], { cwd: root, input: fix });
		git("commit", "-q", "-m", regression.message);
	};
}

export const seedReviewReal = seedRealRegression(PACKAGE_VERSION_REGRESSION);
export const seedReviewHeldOut = seedRealRegression(UTC_MIDNIGHT_REGRESSION);
