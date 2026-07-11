import { spawnSync } from "node:child_process";

export function lastGitCommitDate(
	relPath: string,
	root: string,
): string | null {
	const proc = spawnSync("git", ["log", "-1", "--format=%cs", "--", relPath], {
		cwd: root,
		encoding: "utf8",
	});
	if (proc.status !== 0) return null;
	const date = proc.stdout.trim();
	return date || null;
}
