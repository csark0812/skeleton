import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { normalizeRelPath } from "./shared.ts";

export type FileSource = "worktree" | "index";

function gitShow(root: string, spec: string): string | null {
	const proc = spawnSync("git", ["show", spec], {
		cwd: root,
		encoding: "utf8",
		maxBuffer: 20_000_000,
	});
	if (proc.status !== 0) return null;
	return proc.stdout;
}

/** Read a repo-relative file from the worktree or the git index. */
export function readRepoText(
	root: string,
	relPath: string,
	source: FileSource = "worktree",
): string | null {
	const normalized = normalizeRelPath(relPath);
	if (source === "index") return gitShow(root, `:${normalized}`);
	const abs = join(root, normalized);
	if (!existsSync(abs)) return null;
	return readFileSync(abs, "utf8");
}

/** True when worktree bytes differ from HEAD, including new untracked files. */
export function pathDiffersFromHead(root: string, relPath: string): boolean {
	const normalized = normalizeRelPath(relPath);
	const head = gitShow(root, `HEAD:${normalized}`);
	const worktree = readRepoText(root, normalized, "worktree");
	if (worktree === null) return head !== null;
	return worktree !== (head ?? "");
}
