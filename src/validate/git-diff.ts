import { spawnSync } from "node:child_process";
import { findRepoRoot } from "../audit/config/load.ts";
import { normalizeRelPath } from "../audit/core/shared.ts";

export interface GitDiffOptions {
	staged?: boolean;
	base?: string;
	root?: string;
}

export interface ChangedGitPath {
	path: string;
	deleted: boolean;
}

export function gitDiffChangedFiles(options: GitDiffOptions = {}): ChangedGitPath[] {
	const root = options.root ?? findRepoRoot();
	const proc = spawnSync("git", gitDiffArgs(options), { cwd: root, encoding: "utf8" });
	if (proc.status !== 0) {
		throw new Error(proc.stderr?.trim() || "git diff failed");
	}

	return parseChangedPaths(proc.stdout);
}

function gitDiffArgs(options: GitDiffOptions): string[] {
	const prefix = options.staged
		? ["diff", "--cached"]
		: ["diff", options.base ? `${options.base}...HEAD` : "HEAD"];
	return [...prefix, "--name-status", "--find-renames", "--diff-filter=ACMRD"];
}

function parseChangedPaths(output: string): ChangedGitPath[] {
	const changed = new Map<string, ChangedGitPath>();
	for (const line of output.split("\n")) addChangedLine(changed, line);
	return [...changed.values()];
}

function addChangedLine(changed: Map<string, ChangedGitPath>, line: string): void {
	const [status = "", first = "", second] = line.split("\t");
	if (!first) return;
	const paths = status.startsWith("R") || status.startsWith("C") ? [first, second] : [first];
	for (const raw of paths) addChangedPath({ changed, status, first, raw });
}

function addChangedPath(input: {
	changed: Map<string, ChangedGitPath>;
	status: string;
	first: string;
	raw: string | undefined;
}): void {
	const { changed, status, first, raw } = input;
	if (!raw) return;
	const path = normalizeRelPath(raw);
	changed.set(path, {
		path,
		deleted: status.startsWith("D") || (status.startsWith("R") && raw === first),
	});
}
