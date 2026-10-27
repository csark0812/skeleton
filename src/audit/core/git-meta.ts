import { spawnSync } from "node:child_process";

/**
 * UTC day of the last commit that changed a file. Null for an uncommitted or untracked file,
 * or a repository without history.
 */
export function lastCommitDay(root: string, relPath: string): string | null {
	const proc = spawnSync("git", ["log", "-1", "--format=%ct", "--", relPath], {
		cwd: root,
		encoding: "utf8",
	});
	const time = proc.status === 0 ? proc.stdout.trim() : "";
	if (!/^\d+$/.test(time)) return null;
	return new Date(Number(time) * 1000).toISOString().slice(0, 10);
}

/** A file's text at one commit, or null when it did not exist there. */
export function readAtCommit(root: string, sha: string, relPath: string): string | null {
	// `./` resolves from cwd like `git blame -- path`, also when the root is a subdirectory.
	const proc = spawnSync("git", ["show", `${sha}:./${relPath}`], {
		cwd: root,
		encoding: "utf8",
		maxBuffer: 20_000_000,
	});
	return proc.status === 0 ? proc.stdout : null;
}
