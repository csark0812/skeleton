import { describe, expect, it } from "bun:test";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { attestDocuments, repairReviewProof } from "../core/review-proof.ts";
import { formatReviewProofFile, parseReviewProofFile } from "../core/review-proof-file.ts";
import { evaluateAudit, parseAuditArgs } from "../run.ts";

const PROOF = ".skeleton/review-proof";

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

function writeDoc(root: string, relPath: string, deps: string, meta = "owner=eng"): void {
	writeFileSync(
		join(root, relPath),
		`# ${relPath}

<!-- source-of-truth: ${relPath} behavior -->

<!-- doc-meta: ${meta} -->

<!-- review-deps: paths=${deps} -->

Body of ${relPath}.
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

/** CI runners have no git identity, so every command that may commit sets one. */
const GIT_ENV = {
	...process.env,
	GIT_AUTHOR_NAME: "test",
	GIT_AUTHOR_EMAIL: "test@example.com",
	GIT_COMMITTER_NAME: "test",
	GIT_COMMITTER_EMAIL: "test@example.com",
};

function git(root: string, ...args: string[]): string {
	return execFileSync("git", args, { cwd: root, encoding: "utf8", env: GIT_ENV });
}

function commitAll(root: string, message: string): void {
	if (!existsSync(join(root, ".git"))) git(root, "init", "-q", "-b", "main");
	git(root, "add", "-A");
	git(root, "commit", "-q", "-m", message);
}

function proofText(root: string): string {
	return readFileSync(join(root, PROOF), "utf8");
}

function entryLine(root: string, document: string): string {
	return proofText(root)
		.split("\n")
		.find((line) => line.startsWith(`${document} doc=`)) as string;
}

async function codes(root: string, paths?: string[]): Promise<Array<[string, string]>> {
	const result = await evaluateAudit(auditOptions(root, paths));
	return result.diagnostics.map((item) => [item.file, item.code ?? ""]);
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

function sha256(content: string): string {
	return `sha256:${createHash("sha256").update(content, "utf8").digest("hex")}`;
}

describe("review proof file format", () => {
	it("writes a header, sorted entries, and one blank line between entries", () => {
		const text = formatReviewProofFile([
			{ document: "b.md", documentHash: `sha256:${"b".repeat(16)}`, dependenciesHash: null },
			{
				document: "a.md",
				documentHash: `sha256:${"a".repeat(16)}`,
				dependenciesHash: `sha256:${"c".repeat(16)}`,
			},
		]);
		const lines = text.split("\n");
		expect(lines[0]?.startsWith("# Skeleton review proof.")).toBe(true);
		expect(text).toContain(
			`\n\na.md doc=sha256:${"a".repeat(16)} deps=sha256:${"c".repeat(16)}\n\nb.md doc=sha256:${"b".repeat(16)} deps=none\n`,
		);
		const parsed = parseReviewProofFile(text);
		expect(parsed.status === "valid" && [...parsed.entries.keys()]).toEqual(["a.md", "b.md"]);
	});

	it("parses a CRLF checkout the same as the LF file it writes", () => {
		const parsed = parseReviewProofFile(
			`# header\r\n\r\na.md doc=sha256:${"0".repeat(16)} deps=none\r\n`,
		);
		expect(parsed.status === "valid" && [...parsed.entries.keys()]).toEqual(["a.md"]);
	});

	it("reports conflict markers and duplicate entries as a conflict, and bad lines as invalid", () => {
		const a = `a.md doc=sha256:${"1".repeat(16)} deps=none`;
		const a2 = `a.md doc=sha256:${"2".repeat(16)} deps=none`;
		expect(
			parseReviewProofFile(`<<<<<<< ours\n${a}\n=======\n${a2}\n>>>>>>> theirs\n`).status,
		).toBe("conflicted");
		expect(parseReviewProofFile(`${a}\n\n${a2}\n`).status).toBe("conflicted");
		expect(parseReviewProofFile("a.md doc=nope\n")).toEqual({ status: "invalid", line: 1 });
	});
});

describe("single-file review proof", () => {
	it("writes one entry per document into one file and leaves the document alone", () => {
		const root = makeRepo();
		try {
			const before = readFileSync(join(root, "docs/example.md"), "utf8");
			const result = attestDocuments({ root, paths: ["docs/example.md"] });
			expect(result.proofFile).toBe(PROOF);
			expect(result.modifiedFiles).toEqual([PROOF]);
			expect(readFileSync(join(root, "docs/example.md"), "utf8")).toBe(before);
			expect(entryLine(root, "docs/example.md")).toMatch(
				/^docs\/example\.md doc=sha256:[a-f0-9]{16} deps=sha256:[a-f0-9]{16}$/,
			);
			expect(existsSync(join(root, ".skeleton/reviews"))).toBe(false);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("binds the reviewed document and dependency bytes", async () => {
		const root = makeRepo();
		try {
			attestDocuments({ root, paths: ["docs/example.md"] });
			const valid = await evaluateAudit(auditOptions(root));
			expect(valid.exitCode).toBe(0);
			expect(valid.reviewProof).toEqual({ mode: "hash", status: "valid", proofFile: PROOF });

			commitAll(root, "review");
			writeFileSync(join(root, "src/example.ts"), "export function runThing() { return 2; }\n");
			expect(await changedLinks(root)).toEqual(["src/example.ts"]);

			attestDocuments({ root, paths: ["docs/example.md"] });
			writeFileSync(
				join(root, "docs/example.md"),
				`${readFileSync(join(root, "docs/example.md"), "utf8")}\nChanged after review.\n`,
			);
			expect(await codes(root)).toEqual([["docs/example.md", "review-document-changed"]]);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("reports a changed dependency without naming it when git has no history", async () => {
		const root = makeRepo();
		try {
			attestDocuments({ root, paths: ["docs/example.md"] });
			writeFileSync(join(root, "src/example.ts"), "export function runThing() { return 2; }\n");
			expect(await changedLinks(root)).toEqual([""]);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("rewrites only the attested entries and keeps every other line byte-identical", () => {
		const root = makeRepo();
		try {
			writeDoc(root, "docs/a.md", "src/example.ts");
			writeDoc(root, "docs/b.md", "src/example.ts");
			attestDocuments({ root, paths: ["docs/a.md", "docs/b.md", "docs/example.md"] });
			const before = proofText(root).split("\n");
			writeFileSync(
				join(root, "docs/b.md"),
				`${readFileSync(join(root, "docs/b.md"), "utf8")}More.\n`,
			);
			attestDocuments({ root, paths: ["docs/b.md"] });
			const after = proofText(root).split("\n");
			const changed = after.filter((line, index) => line !== before[index]);
			expect(changed).toEqual([entryLine(root, "docs/b.md")]);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("ignores doc-meta edits and removes a legacy date when it attests", async () => {
		const root = makeRepo();
		try {
			writeDoc(root, "docs/example.md", "src/example.ts", "owner=eng | last-reviewed=2026-08-19");
			const result = attestDocuments({ root, paths: ["docs/example.md"] });
			expect(result.modifiedFiles).toEqual(["docs/example.md", PROOF]);
			const doc = join(root, "docs/example.md");
			writeFileSync(doc, readFileSync(doc, "utf8").replace("owner=eng -->", "owner=docs -->"));
			expect(await codes(root)).toEqual([]);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	for (const order of [
		["docs/a.md", "docs/b.md", "docs/c.md"],
		["docs/c.md", "docs/b.md", "docs/a.md"],
	]) {
		it(`binds dependencies on documents attested in the same run (${order.join(",")})`, async () => {
			const root = makeRepo();
			try {
				writeDoc(root, "docs/a.md", "docs/b.md", "owner=eng | last-reviewed=2026-08-19");
				writeDoc(root, "docs/b.md", "docs/c.md", "owner=eng | last-reviewed=2026-08-19");
				writeDoc(root, "docs/c.md", "src/example.ts");
				attestDocuments({ root, paths: order });
				expect(await codes(root, order)).toEqual([]);
			} finally {
				rmSync(root, { recursive: true, force: true });
			}
		});
	}

	it("binds mutually dependent documents attested in the same run", async () => {
		const root = makeRepo();
		try {
			writeDoc(root, "docs/a.md", "docs/b.md");
			writeDoc(root, "docs/b.md", "docs/a.md");
			attestDocuments({ root, paths: ["docs/b.md", "docs/a.md"] });
			expect(await codes(root, ["docs/a.md", "docs/b.md"])).toEqual([]);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("requires explicit confirmation and paths for doc-meta attestation", () => {
		expect(() => parseAuditArgs(["--fix=doc-meta"])).toThrow(/confirm-reviewed/i);
		expect(() => parseAuditArgs(["--fix=doc-meta", "--confirm-reviewed"])).toThrow(/paths/i);
		expect(parseAuditArgs(["--fix=review-proof"]).fix).toBe("review-proof");
	});

	it("reports a missing entry, a malformed file, and refuses to attest over a malformed file", async () => {
		const root = makeRepo();
		try {
			expect(await codes(root)).toEqual([["docs/example.md", "review-proof-missing"]]);
			mkdirSync(join(root, ".skeleton"), { recursive: true });
			writeFileSync(join(root, PROOF), "docs/example.md doc=broken\n");
			expect(await codes(root)).toEqual([[PROOF, "review-proof-invalid"]]);
			expect(() => attestDocuments({ root, paths: ["docs/example.md"] })).toThrow(/malformed/);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("honors a configured proof file", async () => {
		const root = makeRepo();
		try {
			writeFileSync(
				join(root, "skeleton.toml"),
				`${readFileSync(join(root, "skeleton.toml"), "utf8")}\n[reviewProof]\nfile = "proof.txt"\n`,
			);
			expect(attestDocuments({ root, paths: ["docs/example.md"] }).proofFile).toBe("proof.txt");
			expect((await evaluateAudit(auditOptions(root))).reviewProof.proofFile).toBe("proof.txt");
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
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
		attestDocuments({ root, paths: ["docs/example.md"] });
		commitAll(root, "review");
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

	it("indexes arrays in a selector, so a changed array element invalidates the review", async () => {
		const root = makeRepo();
		try {
			writeFileSync(join(root, "files.json"), `${JSON.stringify({ files: ["a", "b"] })}\n`);
			writeDoc(root, "docs/example.md", "src/example.ts,files.json#files.0");
			attestDocuments({ root, paths: ["docs/example.md"] });
			commitAll(root, "review");
			writeFileSync(join(root, "files.json"), `${JSON.stringify({ files: ["a", "c"] })}\n`);
			expect(await changedLinks(root)).toEqual([]);
			writeFileSync(join(root, "files.json"), `${JSON.stringify({ files: ["z", "c"] })}\n`);
			expect(await changedLinks(root)).toEqual(["files.json"]);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("rejects a selector on a glob or a non-JSON file", async () => {
		const root = makeRepo();
		try {
			writeDoc(root, "docs/example.md", "src/example.ts#exports");
			expect(() => attestDocuments({ root, paths: ["docs/example.md"] })).toThrow(
				/selector needs one \.json file/,
			);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});

describe("repairing review proof (--fix=review-proof)", () => {
	function legacyRepo(): string {
		const root = makeRepo();
		writeDoc(root, "docs/example.md", "src/example.ts", "owner=eng | last-reviewed=2026-08-19");
		writeDoc(root, "docs/stale.md", "src/example.ts", "owner=eng | last-reviewed=2026-08-19");
		const doc = readFileSync(join(root, "docs/example.md"), "utf8");
		const source = readFileSync(join(root, "src/example.ts"), "utf8");
		mkdirSync(join(root, ".skeleton"), { recursive: true });
		writeFileSync(
			join(root, ".skeleton/review-lock.json"),
			JSON.stringify({
				version: 2,
				documents: {
					"docs/example.md": {
						reviewedAt: "2026-08-19",
						documentHash: sha256(doc),
						reviewDependencies: { "src/example.ts": sha256(source) },
					},
					"docs/stale.md": {
						reviewedAt: "2026-08-19",
						documentHash: sha256("older bytes"),
						reviewDependencies: { "src/example.ts": sha256(source) },
					},
				},
			}),
		);
		return root;
	}

	it("blocks per-document checks while a legacy proof exists", async () => {
		const root = legacyRepo();
		try {
			expect((await codes(root)).map(([, code]) => code)).toEqual(["review-proof-legacy"]);
			expect(() => attestDocuments({ root, paths: ["docs/example.md"] })).toThrow(/Legacy/);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("migrates a Skeleton 5 lock: only verifying proofs carry over, dates go, the lock goes", async () => {
		const root = legacyRepo();
		try {
			const result = repairReviewProof({ root });
			expect(result.migrated).toEqual(["docs/example.md"]);
			expect(result.unverified).toEqual(["docs/stale.md"]);
			expect(existsSync(join(root, ".skeleton/review-lock.json"))).toBe(false);
			for (const doc of ["docs/example.md", "docs/stale.md"]) {
				expect(readFileSync(join(root, doc), "utf8")).not.toContain("last-reviewed");
			}
			expect(await codes(root, ["docs/example.md", "docs/stale.md"])).toEqual([
				["docs/stale.md", "review-proof-missing"],
			]);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("does not ask for a review of a legacy entry that a current entry already covers", () => {
		const root = legacyRepo();
		try {
			writeFileSync(join(root, PROOF), "");
			rmSync(join(root, ".skeleton/review-lock.json"));
			attestDocuments({ root, paths: ["docs/stale.md"] });
			mkdirSync(join(root, ".skeleton"), { recursive: true });
			writeFileSync(
				join(root, ".skeleton/review-lock.json"),
				JSON.stringify({
					version: 2,
					documents: {
						"docs/stale.md": {
							reviewedAt: "2026-08-19",
							documentHash: sha256("older bytes"),
							reviewDependencies: {},
						},
					},
				}),
			);
			expect(repairReviewProof({ root }).unverified).toEqual([]);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("migrates Skeleton 6 per-document proof files", async () => {
		const root = makeRepo();
		try {
			const doc = readFileSync(join(root, "docs/example.md"), "utf8");
			const source = readFileSync(join(root, "src/example.ts"), "utf8");
			mkdirSync(join(root, ".skeleton/reviews/docs"), { recursive: true });
			writeFileSync(
				join(root, ".skeleton/reviews/docs/example.md.json"),
				JSON.stringify({
					version: 3,
					documentHash: sha256(doc.replace(/<!-- doc-meta:[^>]*-->/, "<!-- doc-meta -->")),
					reviewDependencies: { "src/example.ts": sha256(source) },
				}),
			);
			expect(repairReviewProof({ root }).migrated).toEqual(["docs/example.md"]);
			expect(existsSync(join(root, ".skeleton/reviews"))).toBe(false);
			expect(await codes(root)).toEqual([]);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("moves the entry of a renamed document and removes the entry of a deleted one", async () => {
		const root = makeRepo();
		try {
			writeDoc(root, "docs/gone.md", "src/example.ts");
			attestDocuments({ root, paths: ["docs/example.md", "docs/gone.md"] });
			rmSync(join(root, "docs/gone.md"));
			const renamed = readFileSync(join(root, "docs/example.md"), "utf8");
			rmSync(join(root, "docs/example.md"));
			writeFileSync(join(root, "docs/renamed.md"), renamed);
			expect(
				(await evaluateAudit({ ...auditOptions(root), paths: [] })).diagnostics,
			).toContainEqual(
				expect.objectContaining({ code: "review-proof-orphan", severity: "warning" }),
			);
			const result = repairReviewProof({ root });
			expect(result.moved).toEqual([{ from: "docs/example.md", to: "docs/renamed.md" }]);
			expect(result.removed).toEqual(["docs/gone.md"]);
			expect(await codes(root, ["docs/renamed.md"])).toEqual([]);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});

describe("parallel review proof", () => {
	function repoWithDocs(names: string[]): string {
		const root = makeRepo();
		writeFileSync(join(root, "package.json"), `${JSON.stringify({ name: "x", scripts: {} })}\n`);
		for (const name of names) writeDoc(root, `docs/${name}.md`, "src/example.ts,package.json");
		attestDocuments({ root, paths: names.map((name) => `docs/${name}.md`) });
		commitAll(root, "base");
		return root;
	}

	function reviewOnBranch(root: string, branch: string, doc: string, body: string): void {
		git(root, "checkout", "-q", "-b", branch, "main");
		writeFileSync(
			join(root, doc),
			readFileSync(join(root, doc), "utf8").replace(/Body of .*\./, body),
		);
		attestDocuments({ root, paths: [doc] });
		git(root, "commit", "-q", "-am", `review ${doc}`);
	}

	function tryMerge(root: string, branch: string): boolean {
		return (
			spawnSync("git", ["merge", "-q", "--no-edit", branch], { cwd: root, env: GIT_ENV }).status ===
			0
		);
	}

	it("merges branches that re-attest neighbouring documents without conflicts", async () => {
		const root = repoWithDocs(["a", "b", "c"]);
		try {
			reviewOnBranch(root, "one", "docs/a.md", "Edited a.");
			reviewOnBranch(root, "two", "docs/b.md", "Edited b.");
			git(root, "checkout", "-q", "main");
			expect(tryMerge(root, "one")).toBe(true);
			expect(tryMerge(root, "two")).toBe(true);
			expect(await codes(root, ["docs/a.md", "docs/b.md", "docs/c.md"])).toEqual([]);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("conflicts when both branches re-attest the same document, and --fix=review-proof resolves it", async () => {
		const root = repoWithDocs(["a", "b"]);
		try {
			reviewOnBranch(root, "one", "docs/b.md", "Edited b.");
			git(root, "checkout", "-q", "main");
			writeFileSync(join(root, "src/example.ts"), "export function runThing() { return 3; }\n");
			attestDocuments({ root, paths: ["docs/b.md"] });
			git(root, "commit", "-q", "-am", "change code, review b");
			expect(tryMerge(root, "one")).toBe(false);
			expect(await codes(root, ["docs/b.md"])).toEqual([[PROOF, "review-proof-conflict"]]);
			// Neither side's entry for b covers the merged bytes, so b needs a fresh review;
			// a was not in conflict and keeps its entry, which reports the changed code.
			expect(repairReviewProof({ root }).resolved).toEqual([]);
			expect(await codes(root, ["docs/a.md", "docs/b.md"])).toEqual([
				["docs/a.md", "review-dependency-changed"],
				["docs/b.md", "review-proof-missing"],
			]);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("keeps the side of a conflict that still verifies against the merged bytes", async () => {
		const root = repoWithDocs(["a"]);
		try {
			const good = entryLine(root, "docs/a.md");
			const stale = good.replace(/doc=sha256:[a-f0-9]{16}/, `doc=sha256:${"0".repeat(16)}`);
			writeFileSync(
				join(root, PROOF),
				proofText(root).replace(good, `<<<<<<< ours\n${stale}\n=======\n${good}\n>>>>>>> theirs`),
			);
			expect(repairReviewProof({ root }).resolved).toEqual(["docs/a.md"]);
			expect(entryLine(root, "docs/a.md")).toBe(good);
			expect(await codes(root, ["docs/a.md"])).toEqual([]);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("still fails the merged result when a shared dependency changed on another branch", async () => {
		const root = repoWithDocs(["a", "b"]);
		try {
			git(root, "checkout", "-q", "-b", "deps", "main");
			writeFileSync(join(root, "src/example.ts"), "export function runThing() { return 2; }\n");
			attestDocuments({ root, paths: ["docs/a.md"] });
			git(root, "commit", "-q", "-am", "change code, review a only");
			git(root, "checkout", "-q", "main");
			expect(tryMerge(root, "deps")).toBe(true);
			expect(await codes(root, ["docs/a.md", "docs/b.md"])).toEqual([
				["docs/b.md", "review-dependency-changed"],
			]);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});
