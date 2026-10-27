import { afterEach, describe, expect, it, spyOn } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseAttestArgs } from "../attest/cli.ts";
import { reviewFixCommands } from "../audit/core/report.ts";
import { formatReviewProofFile, parseReviewProofFile } from "../audit/core/review-proof-file.ts";
import { evaluateAudit } from "../audit/run.ts";
import { runInit } from "../init/init.ts";
import { formatReviewBundle, prepareReview } from "../review/prepare.ts";
import { evaluateValidateChanged, runValidateChanged } from "../validate/changed.ts";
import { git, headMessage, review } from "./support/git-repo.ts";

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

describe("skeleton attest", () => {
	it("parses documents, --reason, and --migrate", () => {
		expect(parseAttestArgs(["docs/a.md", "docs/b.md", "--reason", "checked limits"])).toEqual({
			paths: ["docs/a.md", "docs/b.md"],
			reason: "checked limits",
			migrate: false,
			dryRun: false,
		});
		expect(parseAttestArgs(["--migrate"]).migrate).toBe(true);
		expect(() => parseAttestArgs([])).toThrow(/name the documents/);
		expect(() => parseAttestArgs(["--migrate", "docs/a.md"])).toThrow(/takes no documents/);
		expect(() => parseAttestArgs(["--repair"])).toThrow(/--migrate/);
	});

	it("requires a reason to re-attest unchanged text after a dependency change, and records it", () => {
		const root = makeRepo();
		review(root, ["docs/a.md"]);
		write(root, "src/a.ts", "export const a = 2;\n");
		expect(() => review(root, ["docs/a.md"])).toThrow(/--reason/);
		review(root, ["docs/a.md"], { reason: "a is still described correctly" });
		expect(headMessage(root)).toContain(
			"Skeleton-Review-Note: docs/a.md a is still described correctly",
		);
	});

	it("needs no reason when the document text changed", () => {
		const root = makeRepo();
		review(root, ["docs/a.md"]);
		write(root, "src/a.ts", "export const a = 2;\n");
		write(root, "docs/a.md", doc("docs/a.md", "src/a.ts", "a is now 2."));
		expect(() => review(root, ["docs/a.md"])).not.toThrow();
	});

	it("keeps notes readable as TOML and on the fast path", () => {
		const text = formatReviewProofFile([
			{
				document: "a.md",
				documentHash: `sha256:${"a".repeat(16)}`,
				dependenciesHash: null,
				note: 'said "ok"\nline',
			},
		]);
		const parsed = parseReviewProofFile(text);
		expect(parsed.status === "valid" && parsed.entries.get("a.md")?.note).toBe('said "ok" line');
	});
});

describe("fix commands in error output", () => {
	it("names the attest and migrate commands for the documents that need them", () => {
		expect(
			reviewFixCommands([
				{
					rule: "review-proof",
					file: "docs/b.md",
					message: "",
					severity: "error",
					code: "review-dependency-changed",
				},
				{
					rule: "review-proof",
					file: "docs/a.md",
					message: "",
					severity: "error",
					code: "review-proof-missing",
				},
				{
					rule: "review-proof",
					file: ".skeleton/review-lock.toml",
					message: "",
					severity: "error",
					code: "review-lock-retired",
				},
			]),
		).toEqual(["skeleton attest --migrate", "skeleton attest docs/a.md docs/b.md"]);
	});

	it("prints the attest command when validation fails", async () => {
		const root = makeRepo();
		review(root, ["docs/a.md"], { message: "base" });
		write(root, "src/a.ts", "export const a = 2;\n");
		const lines: string[] = [];
		const log = spyOn(console, "log").mockImplementation((line) => lines.push(String(line)));
		try {
			expect(await runValidateChanged({ root, paths: ["src/a.ts"] })).toBe(1);
		} finally {
			log.mockRestore();
		}
		expect(lines.join("\n")).toContain("  skeleton attest docs/a.md");
	});
});

describe("inbound links after a rename", () => {
	it("audits documents that link to a renamed document", async () => {
		const root = makeRepo();
		write(root, "docs/hub.md", doc("docs/hub.md", "src/a.ts", "See [a](a.md)."));
		review(root, ["docs/a.md", "docs/hub.md"], { message: "base" });
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
	it("lists documents attested in the change, unchanged text first, and drops the context guide", async () => {
		const root = makeRepo();
		write(root, "docs/b.md", doc("docs/b.md", "src/a.ts"));
		write(
			root,
			"AGENTS.md",
			"# Agents\n\nKeep tests green.\n\n<!-- skeleton: context-guide -->\n## Skeleton context\n\nLong agent guide.\n",
		);
		review(root, ["docs/a.md", "docs/b.md"], { message: "base" });
		git(root, "checkout", "-q", "-b", "change");
		write(root, "src/a.ts", "export const a = 2;\n");
		write(root, "docs/b.md", doc("docs/b.md", "src/a.ts", "b now says 2."));
		review(root, ["docs/a.md"], { reason: "a does not mention the value" });
		review(root, ["docs/b.md"]);
		const bundle = await prepareReview({ root, base: "main" });
		expect(bundle.attestedDocuments.map((item) => [item.path, item.textChanged])).toEqual([
			["docs/a.md", false],
			["docs/b.md", true],
		]);
		const text = formatReviewBundle(bundle);
		expect(text).toContain(
			"- docs/a.md (text unchanged; changed: src/a.ts; checked: a does not mention the value)",
		);
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
