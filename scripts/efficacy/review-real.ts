import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Workspace } from "@post-print/agent-test";

const REPOSITORY = fileURLToPath(new URL("../..", import.meta.url));
/** A real fix in this repository: release version bumps stopped invalidating document review. */
export const REAL_FIX_COMMIT = "7a605f2";
const REAL_FIX_PATHS = [
	"src/audit/core/review-proof.ts",
	"src/context.ts",
	"src/audit/__tests__/review-proof.test.ts",
	"src/__tests__/context.test.ts",
];
export const REVIEW_REAL_MESSAGE = `Hash every review dependency the same way

Removes the special handling of package.json so every dependency digest is computed
from the file's bytes.`;

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

/** Extract the repository at the real fix, then commit that fix's reversal on a feature branch. */
export function seedReviewReal(workspace: Workspace, arm: "control" | "skeleton"): void {
	const root = workspace.path;
	const git = (...args: string[]) => execFileSync("git", args, { cwd: root });
	const archive = execFileSync("git", ["archive", REAL_FIX_COMMIT], {
		cwd: REPOSITORY,
		maxBuffer: 256 * 1024 * 1024,
	});
	execFileSync("tar", ["-x", "-C", root], { input: archive });
	if (arm === "skeleton") adoptCurrentConfigSchema(root);
	else removeSkeletonMetadata(root);
	git("add", "-A");
	git("commit", "-q", "-m", "Snapshot before the change");
	git("checkout", "-q", "-b", "feature");
	const fix = execFileSync("git", ["show", "--format=", REAL_FIX_COMMIT, "--", ...REAL_FIX_PATHS], {
		cwd: REPOSITORY,
		maxBuffer: 64 * 1024 * 1024,
	});
	execFileSync("git", ["apply", "-R", "--index"], { cwd: root, input: fix });
	git("commit", "-q", "-m", REVIEW_REAL_MESSAGE);
}
