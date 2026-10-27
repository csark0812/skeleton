import { afterEach, describe, expect, it, spyOn } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { evaluateAudit } from "../audit/run.ts";
import { runInit } from "../init/init.ts";
import { formatReviewBundle, prepareReview } from "../review/prepare.ts";
import { evaluateValidateChanged, runValidateChanged } from "../validate/changed.ts";
import { commitAll, git } from "./support/git-repo.ts";

let roots: string[] = [];

function write(root: string, path: string, content: string): void {
	mkdirSync(join(root, path, ".."), { recursive: true });
	writeFileSync(join(root, path), content);
}

function doc(name: string, deps: string, body = `Body of ${name}.`): string {
	return `# ${name}\n\n<!-- source-of-truth: ${name} behavior -->\n\n<!-- doc-meta: owner=eng -->\n\n<!-- review-deps: paths=${deps} -->\n\n${body}\n`;
}

function makeRepo(): string {
	const root = mkdtempSync(join(tmpdir(), "skeleton-friction-"));
	roots.push(root);
	write(
		root,
		"skeleton.toml",
		'daysUntilStale = 365\n[scan]\ninclude = ["docs/**"]\nexclude = []\n',
	);
	write(root, "src/a.ts", "export const a = 1;\n");
	write(root, "docs/a.md", doc("docs/a.md", "src/a.ts"));
	return root;
}

function auditCodes(root: string, paths: string[], only: string) {
	return evaluateAudit({
		suite: "docs",
		strict: false,
		json: false,
		paths,
		only: new Set([only]),
		root,
	});
}

afterEach(() => {
	for (const root of roots) rmSync(root, { recursive: true, force: true });
	roots = [];
});

describe("re-read guidance in error output", () => {
	it("tells the author to update the document when a dependency changes", async () => {
		const root = makeRepo();
		commitAll(root, "base");
		write(root, "src/a.ts", "export const a = 2;\n");
		git(root, "add", "src/a.ts");
		const lines: string[] = [];
		const log = spyOn(console, "log").mockImplementation((line) => lines.push(String(line)));
		try {
			expect(await runValidateChanged({ root, staged: true })).toBe(1);
		} finally {
			log.mockRestore();
		}
		const output = lines.join("\n");
		expect(output).toContain("docs/a.md: error: review required\n  changed: src/a.ts");
		expect(output).toContain("update it in the same change");
		expect(output).toContain("SKIP=<hook id> git commit");
		expect(output).not.toContain("skeleton attest");
	});
});

describe("inbound links after a rename", () => {
	it("audits documents that link to a renamed document", async () => {
		const root = makeRepo();
		write(root, "docs/hub.md", doc("docs/hub.md", "src/a.ts", "See [a](a.md)."));
		commitAll(root, "base");
		git(root, "mv", "docs/a.md", "docs/renamed.md");
		const result = await evaluateValidateChanged({ root, staged: true });
		expect(result.classification.docs).toContain("docs/hub.md");
		expect(result.audits.flatMap((audit) => audit.diagnostics).map((item) => item.rule)).toContain(
			"links",
		);
	});
});

describe("review-deps hints", () => {
	it("warns on a whole package.json dependency and on document cycles", async () => {
		const root = makeRepo();
		write(root, "package.json", '{"name":"x","scripts":{}}\n');
		write(root, "docs/a.md", doc("docs/a.md", "src/a.ts,package.json,docs/b.md"));
		write(root, "docs/b.md", doc("docs/b.md", "docs/a.md"));
		const result = await auditCodes(root, [], "review-deps");
		const codes = result.diagnostics.map((item) => [item.file, item.code]);
		expect(codes).toContainEqual(["docs/a.md", "review-dependency-broad"]);
		expect(codes).toContainEqual(["docs/a.md", "review-dependency-cycle"]);
		expect(codes.filter(([, code]) => code === "review-dependency-cycle")).toHaveLength(1);
		write(root, "docs/a.md", doc("docs/a.md", "src/a.ts,package.json#scripts"));
		expect((await auditCodes(root, [], "review-deps")).diagnostics).toEqual([]);
	});
});

describe("review prepare", () => {
	it("lists documents whose dependencies changed without them, and drops the context guide", async () => {
		const root = makeRepo();
		write(root, "docs/b.md", doc("docs/b.md", "src/a.ts"));
		write(
			root,
			"AGENTS.md",
			"# Agents\n\nKeep tests green.\n\n<!-- skeleton: context-guide -->\n## Skeleton context\n\nLong agent guide.\n",
		);
		commitAll(root, "base");
		git(root, "checkout", "-q", "-b", "change");
		write(root, "src/a.ts", "export const a = 2;\n");
		write(root, "docs/b.md", doc("docs/b.md", "src/a.ts", "b now says 2."));
		commitAll(root, "change a, update b");
		const bundle = await prepareReview({ root, base: "main" });
		expect(bundle.documentsToReread).toEqual([{ path: "docs/a.md", changed: ["src/a.ts"] }]);
		const text = formatReviewBundle(bundle);
		expect(text).toContain("- docs/a.md (changed: src/a.ts)");
		expect(text).toContain("Keep tests green.");
		expect(text).not.toContain("Long agent guide.");
	});
});

describe("init", () => {
	it("adds the catalog to .gitignore once", () => {
		const root = mkdtempSync(join(tmpdir(), "skeleton-init-ignore-"));
		roots.push(root);
		write(root, "package.json", '{"name":"x"}\n');
		write(root, ".gitignore", "node_modules");
		const log = spyOn(console, "log").mockImplementation(() => {});
		try {
			expect(runInit({ cwd: root }).gitignore).toBe("added");
			expect(runInit({ cwd: root }).gitignore).toBe("skipped");
		} finally {
			log.mockRestore();
		}
		expect(readFileSync(join(root, ".gitignore"), "utf8")).toBe(
			"node_modules\n.skeleton/catalog.md\n",
		);
	});
});
