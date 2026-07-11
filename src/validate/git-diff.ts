import { spawnSync } from "node:child_process";
import { findRepoRoot } from "../audit/config/load.ts";
import { normalizeRelPath } from "../audit/core/shared.ts";

export interface GitDiffOptions {
	staged?: boolean;
	base?: string;
	root?: string;
}

export function gitDiffChangedFiles(options: GitDiffOptions = {}): string[] {
	const root = options.root ?? findRepoRoot();
	let args: string[];

	if (options.staged) {
		args = ["diff", "--cached", "--name-only", "--diff-filter=ACMR"];
	} else if (options.base) {
		args = ["diff", `${options.base}...HEAD`, "--name-only", "--diff-filter=ACMR"];
	} else {
		args = ["diff", "HEAD", "--name-only", "--diff-filter=ACMR"];
	}

	const proc = spawnSync("git", args, { cwd: root, encoding: "utf8" });
	if (proc.status !== 0) {
		throw new Error(proc.stderr?.trim() || "git diff failed");
	}

	return proc.stdout
		.split("\n")
		.map((line) => normalizeRelPath(line.trim()))
		.filter(Boolean);
}
