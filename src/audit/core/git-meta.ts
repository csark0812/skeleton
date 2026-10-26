import { spawnSync } from "node:child_process";

/** The commit that last changed one line of a file, with its UTC committer day. */
export interface LineCommit {
	sha: string;
	day: string;
}

/**
 * Blame one line of the working-tree file. Returns null for an uncommitted line,
 * an untracked file, or a repository without history.
 */
export function lastCommitOfLine(root: string, relPath: string, line: number): LineCommit | null {
	const proc = spawnSync("git", ["blame", "--porcelain", "-L", `${line},${line}`, "--", relPath], {
		cwd: root,
		encoding: "utf8",
	});
	if (proc.status !== 0) return null;
	const sha = /^([0-9a-f]{40}) /.exec(proc.stdout)?.[1];
	const time = /^committer-time (\d+)$/m.exec(proc.stdout)?.[1];
	if (!(sha && time) || /^0+$/.test(sha)) return null;
	return { sha, day: new Date(Number(time) * 1000).toISOString().slice(0, 10) };
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
