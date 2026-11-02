import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";

/** CI runners have no git identity, so every command that may commit sets one. */
export const GIT_ENV = {
	...process.env,
	GIT_AUTHOR_NAME: "test",
	GIT_AUTHOR_EMAIL: "test@example.com",
	GIT_COMMITTER_NAME: "test",
	GIT_COMMITTER_EMAIL: "test@example.com",
};

export function git(root: string, ...args: string[]): string {
	return execFileSync("git", args, { cwd: root, encoding: "utf8", env: GIT_ENV });
}

/** Stage and commit everything, creating the repository on first use. */
export function commitAll(root: string, message: string): void {
	if (!existsSync(join(root, ".git"))) git(root, "init", "-q", "-b", "main");
	git(root, "add", "-A");
	git(root, "commit", "-q", "--allow-empty", "--no-verify", "-m", message);
}
