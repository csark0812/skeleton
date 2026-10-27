import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { type AttestDocumentsResult, attestDocuments } from "../../audit/core/review-proof.ts";

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

/** Create the repository on first use; the local identity also covers `attest`'s commit-tree. */
export function ensureRepo(root: string): void {
	if (existsSync(join(root, ".git"))) return;
	git(root, "init", "-q", "-b", "main");
	git(root, "config", "user.name", "test");
	git(root, "config", "user.email", "test@example.com");
	git(root, "config", "commit.gpgsign", "false");
}

export function commitAll(root: string, message: string): void {
	ensureRepo(root);
	git(root, "add", "-A");
	git(root, "commit", "-q", "--allow-empty", "-m", message);
}

/** Commit pending edits, then attest: a review records committed bytes. */
export function review(
	root: string,
	paths: string[],
	options: { reason?: string; message?: string } = {},
): AttestDocumentsResult {
	ensureRepo(root);
	if (git(root, "status", "--porcelain").trim() !== "") commitAll(root, options.message ?? "edit");
	return attestDocuments({ root, paths, reason: options.reason });
}

export function headMessage(root: string): string {
	return git(root, "log", "-1", "--format=%B");
}

/**
 * A fixture folder inside this repository cannot carry its own review history, so copy it into a
 * fresh repository, commit it, and attest every document it reviews.
 */
export function reviewedCopy(fixture: string, documents: string[]): string {
	const root = mkdtempSync(join(tmpdir(), "skeleton-fixture-"));
	cpSync(fixture, root, { recursive: true });
	review(root, documents, { message: "fixture" });
	return root;
}
