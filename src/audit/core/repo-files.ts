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

/** True when the worktree (or index) bytes differ from HEAD, including new untracked files. */
export function pathDiffersFromHead(
	root: string,
	relPath: string,
	source: FileSource = "worktree",
): boolean {
	const normalized = normalizeRelPath(relPath);
	const head = gitShow(root, `HEAD:${normalized}`);
	const current = readRepoText(root, normalized, source);
	if (current === null) return head !== null;
	return current !== (head ?? "");
}

/** Paths in the git index; empty outside a repository. */
export function trackedPaths(root: string): string[] {
	const proc = spawnSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8" });
	return proc.status === 0 ? proc.stdout.split("\0").filter(Boolean) : [];
}
