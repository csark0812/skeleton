import { describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse as parseToml } from "smol-toml";
import {
	commitAll,
	ensureRepo,
	GIT_ENV,
	git,
	headMessage,
	review,
} from "../../__tests__/support/git-repo.ts";
import { parseAttestationLines } from "../core/review-history.ts";
import { attestDocuments, documentReviewDigest, migrateReviewLock } from "../core/review-proof.ts";
import { formatReviewProofFile, parseReviewProofFile } from "../core/review-proof-file.ts";
import { evaluateAudit, parseAuditArgs } from "../run.ts";

const LOCK = ".skeleton/review-lock.toml";

function makeRepo(): string {
	const root = mkdtempSync(join(tmpdir(), "skeleton-review-proof-"));
	mkdirSync(join(root, "docs"), { recursive: true });
	mkdirSync(join(root, "src"), { recursive: true });
	writeFileSync(
		join(root, "skeleton.toml"),
		`daysUntilStale = 365

[scan]
include = ["docs/**"]
exclude = []
`,
	);
	writeFileSync(join(root, "src/example.ts"), "export function runThing() { return 1; }\n");
	writeDoc(root, "docs/example.md", "src/example.ts");
	return root;
}

function writeDoc(
	root: string,
	relPath: string,
	deps: string,
	meta = "owner=eng",
	body = `Body of ${relPath}.`,
): void {
	writeFileSync(
		join(root, relPath),
		`# ${relPath}

<!-- source-of-truth: ${relPath} behavior -->

<!-- doc-meta: ${meta} -->

<!-- review-deps: paths=${deps} -->

${body}
`,
	);
}

function auditOptions(root: string, paths = ["docs/example.md"]) {
	return {
		suite: "docs",
		strict: false,
		json: false,
		paths,
		only: new Set(["review-proof"]),
		root,
	};
}

async function codes(root: string, paths?: string[]): Promise<Array<[string, string]>> {
	const result = await evaluateAudit(auditOptions(root, paths));
	return result.diagnostics.map((item) => [item.file, item.code ?? ""]);
}

async function severities(root: string, paths: string[]): Promise<Array<[string, string, string]>> {
	const result = await evaluateAudit(auditOptions(root, paths));
	return result.diagnostics.map((item) => [item.file, item.code ?? "", item.severity]);
}

async function changedLinks(root: string): Promise<string[]> {
	const result = await evaluateAudit(auditOptions(root));
	return result.diagnostics
		.filter((item) => item.code === "review-dependency-changed")
		.map((item) => item.link ?? "");
}

function editJson(path: string, edit: (value: Record<string, unknown>) => void): void {
	const value = JSON.parse(readFileSync(path, "utf8"));
	edit(value);
	writeFileSync(path, `${JSON.stringify(value, null, "\t")}\n`);
}

function withRepo(run: (root: string) => Promise<void> | void) {
	return async () => {
		const root = makeRepo();
		try {
			await run(root);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	};
}

describe("Skeleton 8 review lock reader (migration only)", () => {
	const A = `sha256:${"a".repeat(16)}`;
	const B = `sha256:${"b".repeat(16)}`;
	const C = `sha256:${"c".repeat(16)}`;

	it("writes a header, a version, sorted entries, and one blank line between entries", () => {
		const text = formatReviewProofFile([
			{ document: "b.md", documentHash: B, dependenciesHash: null },
			{ document: "a.md", documentHash: A, dependenciesHash: C },
		]);
		expect(text.split("\n")[0]?.startsWith("# Skeleton review lock.")).toBe(true);
		expect(text).toContain(
			`version = 4\n\n"a.md" = { doc = "${A}", deps = "${C}" }\n\n"b.md" = { doc = "${B}" }\n`,
		);
		const parsed = parseReviewProofFile(text);
		expect(parsed.status === "valid" && [...parsed.entries.keys()]).toEqual(["a.md", "b.md"]);
	});

	it("is valid TOML, and a valid hand-reformatted lock still reads", () => {
		const text = formatReviewProofFile([
			{ document: "a.md", documentHash: A, dependenciesHash: C },
		]);
		expect(parseToml(text)).toEqual({ version: 4, "a.md": { doc: A, deps: C } });
		const reformatted = `version = 4\n["a.md"]\ndoc = "${A}"\ndeps = "${C}"\n`;
		const parsed = parseReviewProofFile(reformatted);
		expect(parsed.status === "valid" && parsed.entries.get("a.md")?.dependenciesHash).toBe(C);
	});

	it("requires exactly one version line, and writes keys TOML accepts", () => {
		expect(parseReviewProofFile(`"a.md" = { doc = "${A}" }\n`)).toEqual({
			status: "invalid",
			line: 1,
		});
		expect(parseReviewProofFile(`version = 4\nversion = 4\n`)).toEqual({
			status: "invalid",
			line: 2,
		});
		const odd = formatReviewProofFile([
			{ document: 'we"ird\\path\u007f.md', documentHash: A, dependenciesHash: null },
		]);
		expect(parseToml(odd)).toEqual({ version: 4, 'we"ird\\path\u007f.md': { doc: A } });
		expect(() =>
			formatReviewProofFile([{ document: "version", documentHash: A, dependenciesHash: null }]),
		).toThrow(/version/);
	});

	it("parses a CRLF checkout the same as the LF file it writes", () => {
		const parsed = parseReviewProofFile(
			`# header\r\nversion = 4\r\n\r\n"a.md" = { doc = "${A}" }\r\n`,
		);
		expect(parsed.status === "valid" && [...parsed.entries.keys()]).toEqual(["a.md"]);
	});

	it("reports conflict markers and duplicate entries as a conflict, and bad lines as invalid", () => {
		const a = `"a.md" = { doc = "${A}" }`;
		const a2 = `"a.md" = { doc = "${B}" }`;
		expect(
			parseReviewProofFile(`<<<<<<< ours\n${a}\n=======\n${a2}\n>>>>>>> theirs\n`).status,
		).toBe("conflicted");
		expect(parseReviewProofFile(`${a}\n\n${a2}\n`).status).toBe("conflicted");
		expect(parseReviewProofFile('"a.md" = { doc = "nope" }\n')).toEqual({
			status: "invalid",
			line: 1,
		});
		expect(parseReviewProofFile("version = 3\n")).toEqual({ status: "invalid", line: 1 });
	});
});

describe("review lines in commit messages", () => {
	it("reads lines anywhere in a message, quoted paths, notes, and migration dates", () => {
		const doc = `sha256:${"a".repeat(16)}`;
		const deps = `sha256:${"b".repeat(16)}`;
		const message = [
			"feat: squash of a pull request (#12)",
			"",
			"* edit docs",
			"",
			"* docs: attest docs/a.md",
			"",
			`Skeleton-Reviewed: docs/a.md doc=${doc} deps=${deps}`,
			"Skeleton-Review-Note: docs/a.md checked the retry limit",
			`Skeleton-Reviewed: "docs/with space.md" doc=${doc} deps=none since=2026-01-02`,
			"",
			"Co-authored-by: someone <a@b.c>",
			`Skeleton-Reviewed: docs/bad.md doc=sha256:short deps=none`,
		].join("\n");
		expect(parseAttestationLines(message)).toEqual([
			{
				document: "docs/a.md",
				documentHash: doc,
				dependenciesHash: deps,
				note: "checked the retry limit",
			},
			{
				document: "docs/with space.md",
				documentHash: doc,
				dependenciesHash: null,
				since: "2026-01-02",
			},
		]);
	});
});

describe("attest", () => {
	it(
		"adds one empty commit whose message carries the review, and changes nothing tracked",
		withRepo((root) => {
			commitAll(root, "base");
			const before = git(root, "rev-parse", "HEAD").trim();
			writeFileSync(join(root, "untracked.txt"), "stays\n");
			const result = attestDocuments({ root, paths: ["docs/example.md"] });
			expect(result.commit).toBe(git(root, "rev-parse", "HEAD").trim());
			expect(git(root, "rev-parse", "HEAD^").trim()).toBe(before);
			expect(git(root, "rev-parse", "HEAD^{tree}")).toBe(
				git(root, "rev-parse", `${before}^{tree}`),
			);
			expect(git(root, "status", "--porcelain")).toBe("?? untracked.txt\n");
			const content = readFileSync(join(root, "docs/example.md"), "utf8");
			expect(headMessage(root)).toMatch(
				new RegExp(
					`^docs: attest docs/example\\.md\\n\\nSkeleton-Reviewed: docs/example\\.md doc=${documentReviewDigest(content)} deps=sha256:[a-f0-9]{16}\\n`,
				),
			);
		}),
	);

	it(
		"refuses an uncommitted document, dependency, or new file that a dependency glob matches",
		withRepo((root) => {
			writeDoc(root, "docs/example.md", "src/**/*.ts");
			commitAll(root, "base");
			const doc = join(root, "docs/example.md");
			writeFileSync(doc, `${readFileSync(doc, "utf8")}More.\n`);
			expect(() => attestDocuments({ root, paths: ["docs/example.md"] })).toThrow(
				/Commit these first, then attest: docs\/example\.md/,
			);
			git(root, "checkout", "--", "docs/example.md");
			writeFileSync(join(root, "src/new.ts"), "export const n = 1;\n");
			expect(() => attestDocuments({ root, paths: ["docs/example.md"] })).toThrow(/src\/new\.ts/);
			rmSync(join(root, "src/new.ts"));
			git(root, "add", "-A");
			expect(() => attestDocuments({ root, paths: ["docs/example.md"] })).not.toThrow();
		}),
	);

	it(
		"refuses before the first commit and makes no commit on a dry run",
		withRepo((root) => {
			ensureRepo(root);
			expect(() => attestDocuments({ root, paths: ["docs/example.md"] })).toThrow(/first commit/);
			commitAll(root, "base");
			const head = git(root, "rev-parse", "HEAD");
			const dry = attestDocuments({ root, paths: ["docs/example.md"], dryRun: true });
			expect(dry.commit).toBeNull();
			expect(dry.message).toContain("Skeleton-Reviewed: docs/example.md");
			expect(git(root, "rev-parse", "HEAD")).toBe(head);
		}),
	);

	it("requires explicit confirmation and paths for doc-meta attestation", () => {
		expect(() => parseAuditArgs(["--fix=doc-meta"])).toThrow(/confirm-reviewed/i);
		expect(() => parseAuditArgs(["--fix=doc-meta", "--confirm-reviewed"])).toThrow(/paths/i);
		expect(parseAuditArgs(["--fix=review-proof"]).fix).toBe("review-proof");
	});
});

describe("review proof from history", () => {
	it(
		"binds the reviewed document and dependency bytes",
		withRepo(async (root) => {
			expect(await codes(root)).toEqual([["docs/example.md", "review-proof-missing"]]);
			review(root, ["docs/example.md"]);
			const valid = await evaluateAudit(auditOptions(root));
			expect(valid.exitCode).toBe(0);
			expect(valid.reviewProof).toEqual({
				mode: "hash",
				status: "valid",
				source: "commit-history",
			});

			writeFileSync(join(root, "src/example.ts"), "export function runThing() { return 2; }\n");
			expect(await changedLinks(root)).toEqual(["src/example.ts"]);

			review(root, ["docs/example.md"], { reason: "checked against the changed code" });
			expect(await codes(root)).toEqual([]);
			const doc = join(root, "docs/example.md");
			writeFileSync(doc, `${readFileSync(doc, "utf8")}\nChanged after review.\n`);
			expect(await codes(root)).toEqual([["docs/example.md", "review-document-changed"]]);
			commitAll(root, "edit without a review");
			expect(await codes(root)).toEqual([["docs/example.md", "review-document-changed"]]);
		}),
	);

	it(
		"accepts any earlier review whose bytes match again, such as after a revert",
		withRepo(async (root) => {
			review(root, ["docs/example.md"]);
			writeFileSync(join(root, "src/example.ts"), "export function runThing() { return 2; }\n");
			commitAll(root, "change code");
			expect(await changedLinks(root)).toEqual(["src/example.ts"]);
			git(root, "revert", "--no-edit", "HEAD");
			expect(await codes(root)).toEqual([]);
		}),
	);

	it(
		"ignores doc-meta edits",
		withRepo(async (root) => {
			review(root, ["docs/example.md"]);
			const doc = join(root, "docs/example.md");
			writeFileSync(doc, readFileSync(doc, "utf8").replace("owner=eng -->", "owner=docs -->"));
			expect(await codes(root)).toEqual([]);
		}),
	);

	for (const order of [
		["docs/a.md", "docs/b.md", "docs/c.md"],
		["docs/c.md", "docs/b.md", "docs/a.md"],
	]) {
		it(
			`binds dependencies on documents attested together (${order.join(",")})`,
			withRepo(async (root) => {
				writeDoc(root, "docs/a.md", "docs/b.md");
				writeDoc(root, "docs/b.md", "docs/c.md");
				writeDoc(root, "docs/c.md", "src/example.ts");
				review(root, order);
				expect(await codes(root, order)).toEqual([]);
			}),
		);
	}

	it(
		"binds mutually dependent documents attested together",
		withRepo(async (root) => {
			writeDoc(root, "docs/a.md", "docs/b.md");
			writeDoc(root, "docs/b.md", "docs/a.md");
			review(root, ["docs/b.md", "docs/a.md"]);
			expect(await codes(root, ["docs/a.md", "docs/b.md"])).toEqual([]);
		}),
	);

	it(
		"cannot check proof in a shallow clone",
		withRepo(async (root) => {
			review(root, ["docs/example.md"]);
			commitAll(root, "second");
			const clone = mkdtempSync(join(tmpdir(), "skeleton-shallow-"));
			try {
				git(clone, "clone", "-q", "--depth=1", `file://${root}`, ".");
				expect(await codes(clone)).toEqual([[".", "review-history-unavailable"]]);
			} finally {
				rmSync(clone, { recursive: true, force: true });
			}
		}),
	);
});

describe("dependency digests", () => {
	function manifestRepo(dependency: string, selectors = ""): string {
		const root = makeRepo();
		mkdirSync(join(root, dependency, ".."), { recursive: true });
		writeFileSync(
			join(root, dependency),
			`${JSON.stringify({ name: "x", version: "1.0.0", scripts: { check: "bun test" }, devDependencies: { a: "1" } }, null, "\t")}\n`,
		);
		writeDoc(root, "docs/example.md", `src/example.ts,${dependency}${selectors}`);
		review(root, ["docs/example.md"]);
		return root;
	}

	it("keeps package.json review evidence across a release version bump", async () => {
		for (const dependency of ["package.json", "packages/app/package.json"]) {
			const root = manifestRepo(dependency);
			try {
				editJson(join(root, dependency), (value) => {
					value.version = "1.0.1";
				});
				expect(await changedLinks(root)).toEqual([]);
				editJson(join(root, dependency), (value) => {
					value.scripts = { check: "bun test && bun run lint" };
				});
				expect(await changedLinks(root)).toEqual([dependency]);
			} finally {
				rmSync(root, { recursive: true, force: true });
			}
		}
	});

	it("binds every other dependency byte for byte, including a version field", async () => {
		const root = manifestRepo("config/release.json");
		try {
			editJson(join(root, "config/release.json"), (value) => {
				value.version = "1.0.1";
			});
			expect(await changedLinks(root)).toEqual(["config/release.json"]);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("binds only the selected JSON key paths", async () => {
		const root = manifestRepo("package.json", "#scripts");
		try {
			editJson(join(root, "package.json"), (value) => {
				value.devDependencies = { a: "2" };
			});
			expect(await changedLinks(root)).toEqual([]);
			editJson(join(root, "package.json"), (value) => {
				value.scripts = { check: "vitest" };
			});
			expect(await changedLinks(root)).toEqual(["package.json"]);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it(
		"indexes arrays in a selector, so a changed array element invalidates the review",
		withRepo(async (root) => {
			writeFileSync(join(root, "files.json"), `${JSON.stringify({ files: ["a", "b"] })}\n`);
			writeDoc(root, "docs/example.md", "src/example.ts,files.json#files.0");
			review(root, ["docs/example.md"]);
			writeFileSync(join(root, "files.json"), `${JSON.stringify({ files: ["a", "c"] })}\n`);
			expect(await changedLinks(root)).toEqual([]);
			writeFileSync(join(root, "files.json"), `${JSON.stringify({ files: ["z", "c"] })}\n`);
			expect(await changedLinks(root)).toEqual(["files.json"]);
		}),
	);

	it(
		"rejects a selector on a glob or a non-JSON file",
		withRepo((root) => {
			writeDoc(root, "docs/example.md", "src/example.ts#exports");
			commitAll(root, "base");
			expect(() => attestDocuments({ root, paths: ["docs/example.md"] })).toThrow(
				/selector needs one \.json file/,
			);
		}),
	);
});

describe("migrating a Skeleton 8 review lock (attest --migrate)", () => {
	function lockFor(root: string, documents: string[], stale: string[] = []): string {
		const entries = documents.map((document) => {
			const result = attestDocuments({ root, paths: [document], dryRun: true });
			const line = parseAttestationLines(result.message)[0];
			if (!line) throw new Error("no review line");
			return {
				document,
				documentHash: stale.includes(document) ? `sha256:${"0".repeat(16)}` : line.documentHash,
				dependenciesHash: line.dependenciesHash,
			};
		});
		return formatReviewProofFile(entries);
	}

	it(
		"carries verifying entries with their date, lists stale ones, and removes the lock in one commit",
		withRepo(async (root) => {
			writeDoc(root, "docs/a.md", "src/example.ts");
			commitAll(root, "base");
			mkdirSync(join(root, ".skeleton"), { recursive: true });
			writeFileSync(
				join(root, LOCK),
				lockFor(root, ["docs/a.md", "docs/example.md"], ["docs/a.md"]),
			);
			git(root, "add", LOCK);
			spawnSync("git", ["commit", "-q", "-m", "lock", "--date=2026-01-02T00:00:00Z"], {
				cwd: root,
				env: { ...GIT_ENV, GIT_COMMITTER_DATE: "2026-01-02T00:00:00Z" },
			});
			expect(await codes(root, [])).toContainEqual([LOCK, "review-lock-retired"]);

			const result = migrateReviewLock({ root });
			expect(result.migrated).toEqual(["docs/example.md"]);
			expect(result.unverified).toEqual(["docs/a.md"]);
			expect(existsSync(join(root, LOCK))).toBe(false);
			expect(git(root, "status", "--porcelain", "--", LOCK)).toBe("");
			expect(git(root, "show", "--name-status", "--format=", "HEAD").trim()).toBe(`D\t${LOCK}`);
			expect(headMessage(root)).toContain("since=2026-01-02");
			expect(await codes(root, [])).toEqual([["docs/a.md", "review-proof-missing"]]);
		}),
	);

	it(
		"refuses a conflicted or uncommitted lock",
		withRepo(() => {
			const root = makeRepo();
			try {
				commitAll(root, "base");
				mkdirSync(join(root, ".skeleton"), { recursive: true });
				writeFileSync(join(root, LOCK), lockFor(root, ["docs/example.md"]));
				expect(() => migrateReviewLock({ root })).toThrow(/Commit .* first/);
				const entry = readFileSync(join(root, LOCK), "utf8");
				writeFileSync(join(root, LOCK), `${entry}<<<<<<< ours\n=======\n>>>>>>> theirs\n`);
				commitAll(root, "conflicted lock");
				expect(() => migrateReviewLock({ root })).toThrow(/merge conflict/);
			} finally {
				rmSync(root, { recursive: true, force: true });
			}
		}),
	);
});

describe("parallel reviews", () => {
	function repoWithDocs(names: string[]): string {
		const root = makeRepo();
		for (const name of names) {
			writeDoc(
				root,
				`docs/${name}.md`,
				"src/example.ts",
				"owner=eng",
				`First of ${name}.\n\nLast of ${name}.`,
			);
		}
		review(root, ["docs/example.md", ...names.map((name) => `docs/${name}.md`)], {
			message: "base",
		});
		return root;
	}

	function editLine(root: string, doc: string, from: string, to: string): void {
		const path = join(root, doc);
		writeFileSync(path, readFileSync(path, "utf8").replace(from, to));
	}

	function reviewOnBranch(
		root: string,
		branch: string,
		doc: string,
		from: string,
		to: string,
	): void {
		git(root, "checkout", "-q", "-b", branch, "main");
		editLine(root, doc, from, to);
		review(root, [doc], { message: `edit ${doc}` });
		git(root, "checkout", "-q", "main");
	}

	function tryMerge(root: string, branch: string): boolean {
		return (
			spawnSync("git", ["merge", "-q", "--no-edit", "--no-ff", branch], { cwd: root, env: GIT_ENV })
				.status === 0
		);
	}

	it("merges branches that review the same document without a conflict", async () => {
		const root = repoWithDocs(["a"]);
		try {
			reviewOnBranch(root, "one", "docs/a.md", "First of a.", "First of a, edited.");
			reviewOnBranch(root, "two", "docs/a.md", "Last of a.", "Last of a, edited.");
			expect(tryMerge(root, "one")).toBe(true);
			expect(await codes(root, [])).toEqual([]);
			expect(tryMerge(root, "two")).toBe(true);
			// No one read the combined text: a warning for the repository, an error for whoever touches it.
			expect(await severities(root, [])).toEqual([
				["docs/a.md", "review-merged-unattested", "warning"],
			]);
			expect(await severities(root, ["docs/a.md"])).toEqual([
				["docs/a.md", "review-merged-unattested", "error"],
			]);
			review(root, ["docs/a.md"]);
			expect(await codes(root, ["docs/a.md"])).toEqual([]);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("treats a squash merge that carries the reviews like a merge", async () => {
		const root = repoWithDocs(["a"]);
		try {
			reviewOnBranch(root, "one", "docs/a.md", "First of a.", "First of a, edited.");
			reviewOnBranch(root, "two", "docs/a.md", "Last of a.", "Last of a, edited.");
			for (const branch of ["one", "two"]) {
				git(root, "merge", "-q", "--squash", branch);
				const bodies = git(root, "log", "--format=%B", `main..${branch}`);
				git(root, "commit", "-q", "-m", `squash ${branch}\n\n${bodies}`);
			}
			expect(await severities(root, [])).toEqual([
				["docs/a.md", "review-merged-unattested", "warning"],
			]);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("passes a squash merge that keeps the review lines, and fails one that drops them", async () => {
		for (const keepBodies of [true, false]) {
			const root = repoWithDocs(["a"]);
			try {
				reviewOnBranch(root, "one", "docs/a.md", "First of a.", "First of a, edited.");
				git(root, "merge", "-q", "--squash", "one");
				const bodies = keepBodies ? git(root, "log", "--format=%B", "main..one") : "";
				git(root, "commit", "-q", "-m", `squash one\n\n${bodies}`);
				git(root, "branch", "-q", "-D", "one");
				expect(await codes(root, [])).toEqual(
					keepBodies ? [] : [["docs/a.md", "review-document-changed"]],
				);
			} finally {
				rmSync(root, { recursive: true, force: true });
			}
		}
	});

	it("never counts a conflict resolution as reviewed", async () => {
		const root = repoWithDocs(["a"]);
		try {
			reviewOnBranch(root, "one", "docs/a.md", "First of a.", "First of a, by one.");
			reviewOnBranch(root, "two", "docs/a.md", "First of a.", "First of a, by two.");
			expect(tryMerge(root, "one")).toBe(true);
			expect(tryMerge(root, "two")).toBe(false);
			editLine(
				root,
				"docs/a.md",
				/<<<<<<< HEAD\n.*\n=======\n.*\n>>>>>>> two\n/s as unknown as string,
				"First of a, resolved.\n",
			);
			git(root, "commit", "-qam", "resolve");
			const reported = await codes(root, []);
			expect(reported).toHaveLength(1);
			expect(reported[0]?.[0]).toBe("docs/a.md");
			expect(reported[0]?.[1]).not.toBe("");
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("still fails the merged result when a shared dependency changed on another branch", async () => {
		const root = repoWithDocs(["a", "b"]);
		try {
			git(root, "checkout", "-q", "-b", "deps", "main");
			writeFileSync(join(root, "src/example.ts"), "export function runThing() { return 2; }\n");
			review(root, ["docs/a.md"], {
				reason: "checked against the changed code",
				message: "change code",
			});
			git(root, "checkout", "-q", "main");
			expect(tryMerge(root, "deps")).toBe(true);
			expect(await codes(root, [])).toEqual([
				["docs/b.md", "review-dependency-changed"],
				["docs/example.md", "review-dependency-changed"],
			]);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});
