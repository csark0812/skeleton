import { afterEach, describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { attestDocuments } from "../../audit/core/review-proof.ts";
import { formatReviewBundle, prepareReview, runReviewCommand } from "../prepare.ts";

let roots: string[] = [];

function git(root: string, args: string[]): void {
	const result = spawnSync("git", args, {
		cwd: root,
		encoding: "utf8",
		env: {
			...process.env,
			GIT_AUTHOR_NAME: "Test",
			GIT_AUTHOR_EMAIL: "test@example.com",
			GIT_COMMITTER_NAME: "Test",
			GIT_COMMITTER_EMAIL: "test@example.com",
		},
	});
	if (result.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
}

function write(root: string, path: string, content: string): void {
	mkdirSync(join(root, path, ".."), { recursive: true });
	writeFileSync(join(root, path), content);
}

function makeRepo(review = ""): string {
	const root = mkdtempSync(join(tmpdir(), "skeleton-review-"));
	roots.push(root);
	write(
		root,
		"skeleton.toml",
		`daysUntilStale = 365\n[scan]\ninclude = ["docs/**", "AGENTS.md"]\nexclude = []\n${review}`,
	);
	write(root, "AGENTS.md", "# Agents\n\nRun the focused test.\n");
	write(root, "src/billing/charge.ts", "export const retries = 1;\n");
	write(root, "src/auth/session.ts", "export const ttl = 60;\n");
	write(
		root,
		"docs/billing.md",
		"# Billing\n\n<!-- source-of-truth: billing retries -->\n\n<!-- doc-meta: owner=billing -->\n\n<!-- review-deps: paths=src/billing/charge.ts -->\n\nBilling retries once.\n",
	);
	write(
		root,
		"docs/billing/REVIEW.md",
		"# Billing review\n\n<!-- review-deps: paths=src/billing/** -->\n\nA retry change must keep payments idempotent.\n",
	);
	write(
		root,
		"docs/auth/REVIEW.md",
		"# Auth review\n\n<!-- review-deps: paths=src/auth/** -->\n\nSessions must expire.\n",
	);
	git(root, ["init", "-q", "-b", "main"]);
	git(root, ["config", "user.name", "Test"]);
	git(root, ["config", "user.email", "test@example.com"]);
	git(root, ["add", "-A"]);
	git(root, ["commit", "-q", "-m", "init"]);
	return root;
}

afterEach(() => {
	for (const root of roots) rmSync(root, { recursive: true, force: true });
	roots = [];
});

describe("review prepare", () => {
	it("bundles the diff, matching review guides, AGENTS.md, and documents to re-read", async () => {
		const root = makeRepo();
		write(root, "src/billing/charge.ts", "export const retries = 2;\n");
		const bundle = await prepareReview({ root });
		expect(bundle.changedPaths).toEqual(["src/billing/charge.ts"]);
		expect(bundle.reviewGuides.map((guide) => guide.path)).toEqual(["docs/billing/REVIEW.md"]);
		expect(bundle.documentsToReread).toEqual([
			{ path: "docs/billing.md", changed: ["src/billing/charge.ts"] },
		]);
		expect(bundle.humanReviewRequired).toEqual([]);
		const text = formatReviewBundle(bundle);
		expect(text).toContain("## Reviewer contract");
		expect(text).toContain("A retry change must keep payments idempotent.");
		expect(text).not.toContain("Sessions must expire.");
		expect(text).toContain("Run the focused test.");
		expect(text).toContain("+export const retries = 2;");
	});

	it("drops a document from the re-read list once the branch attests it", async () => {
		const root = makeRepo();
		attestDocuments({ root, paths: ["docs/billing.md"] });
		git(root, ["checkout", "-q", "-b", "feature"]);
		write(root, "src/billing/charge.ts", "export const retries = 2;\n");
		git(root, ["commit", "-q", "-am", "retry twice"]);
		const before = await prepareReview({ root, base: "main" });
		expect(before.documentsToReread.map((item) => item.path)).toEqual(["docs/billing.md"]);
		attestDocuments({ root, paths: ["docs/billing.md"], reason: "still says the policy" });
		const after = await prepareReview({ root, base: "main" });
		expect(after.documentsToReread).toEqual([]);
		expect(after.attestedDocuments.map((item) => [item.path, item.note])).toEqual([
			["docs/billing.md", "still says the policy"],
		]);
	});

	it("stops when review history is incomplete", async () => {
		const root = makeRepo();
		git(root, ["commit", "-q", "--allow-empty", "-m", "second"]);
		const clone = mkdtempSync(join(tmpdir(), "skeleton-review-shallow-"));
		roots.push(clone);
		git(clone, ["clone", "-q", "--depth=1", `file://${root}`, "."]);
		write(clone, "src/billing/charge.ts", "export const retries = 2;\n");
		await expect(prepareReview({ root: clone })).rejects.toThrow(/shallow clone/);
	});

	it("names high-consequence paths from [review] humanPaths", async () => {
		const root = makeRepo('[review]\nhumanPaths = ["src/auth/**"]\n');
		write(root, "src/auth/session.ts", "export const ttl = 0;\n");
		write(root, "src/billing/charge.ts", "export const retries = 2;\n");
		const bundle = await prepareReview({ root });
		expect(bundle.humanReviewRequired).toEqual(["src/auth/session.ts"]);
		expect(formatReviewBundle(bundle)).toContain(
			"## Human review required\n\nA person must approve changes to these paths. An agent review does not count.\n\n- src/auth/session.ts",
		);
	});

	it("covers untracked files and deleted human paths in the working-tree scope", async () => {
		const root = makeRepo('[review]\nhumanPaths = ["src/auth/**"]\n');
		write(root, "src/billing/refund.ts", "export const refunds = true;\n");
		git(root, ["rm", "-q", "src/auth/session.ts"]);
		const bundle = await prepareReview({ root });
		expect(bundle.changedPaths).toEqual(["src/billing/refund.ts"]);
		expect(bundle.humanReviewRequired).toEqual(["src/auth/session.ts"]);
		expect(bundle.reviewGuides.map((guide) => guide.path)).toEqual(["docs/billing/REVIEW.md"]);
		expect(bundle.diff).toContain("+export const refunds = true;");
	});

	it("fences the diff so changed Markdown cannot close it", async () => {
		const root = makeRepo();
		write(root, "docs/notes.md", "```bash\necho hi\n```\n");
		const text = formatReviewBundle(await prepareReview({ root }));
		expect(text).toContain("````diff\n");
		expect(text.trimEnd().endsWith("````")).toBe(true);
	});

	it("reviews only a branch range under --base", async () => {
		const root = makeRepo();
		git(root, ["checkout", "-q", "-b", "feature"]);
		write(root, "src/billing/charge.ts", "export const retries = 3;\n");
		git(root, ["commit", "-q", "-am", "retry more"]);
		write(root, "src/auth/session.ts", "export const ttl = 1;\n");
		const bundle = await prepareReview({ root, base: "main" });
		expect(bundle.changedPaths).toEqual(["src/billing/charge.ts"]);
		expect(bundle.diff).toContain("+export const retries = 3;");
		expect(bundle.diff).not.toContain("ttl = 1");
	});

	it("hands the bundle to a reviewer command on stdin and returns its status", () => {
		const root = makeRepo();
		const out = join(root, "received.txt");
		expect(
			runReviewCommand({ root, command: `cat > "${out}"; exit 3`, bundle: "bundle text" }),
		).toBe(3);
		expect(Bun.file(out).text()).resolves.toBe("bundle text");
	});
});
