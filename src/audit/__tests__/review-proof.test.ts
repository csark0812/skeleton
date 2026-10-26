import { describe, expect, it } from "bun:test";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { attestDocuments, migrateReviewProof } from "../core/review-proof.ts";
import { evaluateAudit, parseAuditArgs } from "../run.ts";

const PROOF = ".skeleton/reviews/docs/example.md.json";

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
	writeFileSync(
		join(root, "docs/example.md"),
		`# Example

<!-- source-of-truth: example command behavior -->

<!-- doc-meta: owner=eng -->

<!-- review-deps: paths=src/example.ts -->

Call runThing for the example command behavior.
`,
	);
	return root;
}

function auditOptions(root: string) {
	return {
		suite: "docs",
		strict: false,
		json: false,
		paths: ["docs/example.md"],
		only: new Set(["review-proof"]),
		root,
	};
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

function batchAuditOptions(root: string, paths: string[]) {
	return { ...auditOptions(root), paths };
}

function readJson(root: string, relPath: string): Record<string, unknown> {
	return JSON.parse(readFileSync(join(root, relPath), "utf8"));
}

function makeManifestRepo(dependency: string): string {
	const root = makeRepo();
	const manifest = {
		name: "example",
		version: "1.0.0",
		scripts: { check: "bun test" },
		engines: { node: ">=22" },
	};
	mkdirSync(join(root, dependency, ".."), { recursive: true });
	writeFileSync(join(root, dependency), `${JSON.stringify(manifest, null, "\t")}\n`);
	writeFileSync(
		join(root, "docs/example.md"),
		readFileSync(join(root, "docs/example.md"), "utf8").replace(
			"paths=src/example.ts",
			`paths=src/example.ts,${dependency}`,
		),
	);
	attestDocuments({ root, paths: ["docs/example.md"] });
	return root;
}

function editJson(path: string, edit: (value: Record<string, unknown>) => void): void {
	const value = JSON.parse(readFileSync(path, "utf8"));
	edit(value);
	writeFileSync(path, `${JSON.stringify(value, null, "\t")}\n`);
}

async function changedDependencies(root: string): Promise<string[]> {
	const result = await evaluateAudit(auditOptions(root));
	return result.diagnostics
		.filter((item) => item.code === "review-dependency-changed")
		.map((item) => item.link ?? "");
}

function sha256(content: string): string {
	return `sha256:${createHash("sha256").update(content, "utf8").digest("hex")}`;
}

function git(root: string, ...args: string[]): string {
	return execFileSync("git", args, {
		cwd: root,
		encoding: "utf8",
		env: {
			...process.env,
			GIT_AUTHOR_NAME: "test",
			GIT_AUTHOR_EMAIL: "test@example.com",
			GIT_COMMITTER_NAME: "test",
			GIT_COMMITTER_EMAIL: "test@example.com",
		},
	});
}

describe("per-document review proof", () => {
	it("writes one dateless proof file per document and leaves the document bytes alone", async () => {
		const root = makeRepo();
		try {
			const before = readFileSync(join(root, "docs/example.md"), "utf8");
			const result = attestDocuments({ root, paths: ["docs/example.md"] });
			expect(result.proofFiles).toEqual([PROOF]);
			expect(result.modifiedFiles).toEqual([PROOF]);
			expect(readFileSync(join(root, "docs/example.md"), "utf8")).toBe(before);
			const proof = readJson(root, PROOF);
			expect(Object.keys(proof).sort()).toEqual(["documentHash", "reviewDependencies", "version"]);
			expect(proof.version).toBe(3);
			expect(existsSync(join(root, ".skeleton/review-lock.json"))).toBe(false);
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
			expect(valid.reviewProof).toEqual({
				mode: "hash",
				status: "valid",
				proofDir: ".skeleton/reviews",
			});

			writeFileSync(join(root, "src/example.ts"), "export function runThing() { return 2; }\n");
			const codeDrift = await evaluateAudit(auditOptions(root));
			expect(codeDrift.exitCode).toBe(1);
			expect(codeDrift.reviewProof.status).toBe("invalid");
			expect(codeDrift.diagnostics.some((item) => item.code === "review-dependency-changed")).toBe(
				true,
			);

			attestDocuments({ root, paths: ["docs/example.md"] });
			writeFileSync(
				join(root, "docs/example.md"),
				`${readFileSync(join(root, "docs/example.md"), "utf8")}\nChanged after review.\n`,
			);
			const docDrift = await evaluateAudit(auditOptions(root));
			expect(docDrift.diagnostics.some((item) => item.code === "review-document-changed")).toBe(
				true,
			);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("ignores doc-meta edits, so metadata never invalidates a review", async () => {
		const root = makeRepo();
		try {
			attestDocuments({ root, paths: ["docs/example.md"] });
			const doc = join(root, "docs/example.md");
			writeFileSync(
				doc,
				readFileSync(doc, "utf8").replace(
					"owner=eng -->",
					"owner=docs | last-reviewed=2026-08-19 -->",
				),
			);
			expect((await evaluateAudit(auditOptions(root))).diagnostics).toEqual([]);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("removes a legacy last-reviewed date when it attests a document", () => {
		const root = makeRepo();
		try {
			writeDoc(root, "docs/example.md", "src/example.ts", "owner=eng | last-reviewed=2026-08-19");
			const result = attestDocuments({ root, paths: ["docs/example.md"] });
			expect(result.modifiedFiles).toEqual(["docs/example.md", PROOF]);
			expect(readFileSync(join(root, "docs/example.md"), "utf8")).toContain(
				"<!-- doc-meta: owner=eng -->",
			);
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

				const result = await evaluateAudit(batchAuditOptions(root, order));
				expect(result.diagnostics).toEqual([]);
				expect(result.exitCode).toBe(0);
				const proof = (doc: string) => readJson(root, `.skeleton/reviews/${doc}.json`);
				const deps = (doc: string) => proof(doc).reviewDependencies as Record<string, string>;
				expect(deps("docs/a.md")["docs/b.md"]).toBe(proof("docs/b.md").documentHash as string);
				expect(deps("docs/b.md")["docs/c.md"]).toBe(proof("docs/c.md").documentHash as string);
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
			const paths = ["docs/b.md", "docs/a.md"];
			attestDocuments({ root, paths });
			const result = await evaluateAudit(batchAuditOptions(root, paths));
			expect(result.diagnostics).toEqual([]);
			expect(result.exitCode).toBe(0);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("keeps package.json review evidence across a release version bump", async () => {
		for (const dependency of ["package.json", "packages/app/package.json"]) {
			const root = makeManifestRepo(dependency);
			try {
				const manifest = join(root, dependency);
				editJson(manifest, (value) => {
					value.version = "1.0.1";
				});
				expect(await changedDependencies(root)).toEqual([]);

				editJson(manifest, (value) => {
					value.scripts = { check: "bun test && bun run lint" };
				});
				expect(await changedDependencies(root)).toEqual([dependency]);
			} finally {
				rmSync(root, { recursive: true, force: true });
			}
		}
	});

	it("binds every other dependency byte for byte, including a version field", async () => {
		const root = makeManifestRepo("config/release.json");
		try {
			editJson(join(root, "config/release.json"), (value) => {
				value.version = "1.0.1";
			});
			expect(await changedDependencies(root)).toEqual(["config/release.json"]);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("requires explicit confirmation and paths for doc-meta attestation", () => {
		expect(() => parseAuditArgs(["--fix=doc-meta"])).toThrow(/confirm-reviewed/i);
		expect(() => parseAuditArgs(["--fix=doc-meta", "--confirm-reviewed"])).toThrow(/paths/i);
		expect(
			parseAuditArgs(["--paths=docs/example.md", "--fix=doc-meta", "--confirm-reviewed"])
				.confirmReviewed,
		).toBe(true);
	});

	it("reports a missing or malformed proof file without throwing, and a review replaces it", async () => {
		const root = makeRepo();
		try {
			expect((await evaluateAudit(auditOptions(root))).diagnostics).toContainEqual(
				expect.objectContaining({ code: "review-proof-missing", file: "docs/example.md" }),
			);
			mkdirSync(join(root, ".skeleton/reviews/docs"), { recursive: true });
			writeFileSync(join(root, PROOF), JSON.stringify({ version: 3, documentHash: "nope" }));
			const result = await evaluateAudit(auditOptions(root));
			expect(result.exitCode).toBe(1);
			expect(result.diagnostics).toContainEqual(
				expect.objectContaining({ code: "review-proof-invalid", file: PROOF }),
			);
			attestDocuments({ root, paths: ["docs/example.md"] });
			expect((await evaluateAudit(auditOptions(root))).exitCode).toBe(0);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("honors a configured proof directory", async () => {
		const root = makeRepo();
		try {
			writeFileSync(
				join(root, "skeleton.toml"),
				`${readFileSync(join(root, "skeleton.toml"), "utf8")}\n[reviewProof]\ndir = "proof"\n`,
			);
			expect(attestDocuments({ root, paths: ["docs/example.md"] }).proofFiles).toEqual([
				"proof/docs/example.md.json",
			]);
			expect((await evaluateAudit(auditOptions(root))).reviewProof.proofDir).toBe("proof");
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});

describe("version 2 review lock migration", () => {
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

	it("asks for migration while a version 2 lock exists", async () => {
		const root = legacyRepo();
		try {
			const result = await evaluateAudit(auditOptions(root));
			expect(result.diagnostics.map((item) => item.code)).toEqual(["review-proof-legacy-lock"]);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("carries over only proofs that still verify, strips dates, and removes the lock", async () => {
		const root = legacyRepo();
		try {
			const result = migrateReviewProof({ root });
			expect(result.migrated).toEqual(["docs/example.md"]);
			expect(result.unverified).toEqual(["docs/stale.md"]);
			expect(existsSync(join(root, ".skeleton/review-lock.json"))).toBe(false);
			expect(existsSync(join(root, ".skeleton/reviews/docs/stale.md.json"))).toBe(false);
			for (const doc of ["docs/example.md", "docs/stale.md"]) {
				expect(readFileSync(join(root, doc), "utf8")).not.toContain("last-reviewed");
			}
			const audit = await evaluateAudit(
				batchAuditOptions(root, ["docs/example.md", "docs/stale.md"]),
			);
			expect(audit.diagnostics.map((item) => [item.file, item.code])).toEqual([
				["docs/stale.md", "review-proof-missing"],
			]);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("is available as --fix=review-proof without --confirm-reviewed", () => {
		expect(parseAuditArgs(["--fix=review-proof"]).fix).toBe("review-proof");
	});
});

describe("parallel review proof", () => {
	function sharedDependencyRepo(): string {
		const root = makeRepo();
		writeFileSync(join(root, "package.json"), `${JSON.stringify({ name: "x", scripts: {} })}\n`);
		writeDoc(root, "docs/a.md", "src/example.ts,package.json");
		writeDoc(root, "docs/b.md", "src/example.ts,package.json");
		attestDocuments({ root, paths: ["docs/a.md", "docs/b.md"] });
		git(root, "init", "-q", "-b", "main");
		git(root, "add", "-A");
		git(root, "commit", "-q", "-m", "base");
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

	it("merges two branches that re-attest different documents without conflicts", async () => {
		const root = sharedDependencyRepo();
		try {
			reviewOnBranch(root, "one", "docs/a.md", "Edited a.");
			reviewOnBranch(root, "two", "docs/b.md", "Edited b.");
			git(root, "checkout", "-q", "main");
			git(root, "merge", "-q", "--no-edit", "one");
			git(root, "merge", "-q", "--no-edit", "two");
			const audit = await evaluateAudit(batchAuditOptions(root, ["docs/a.md", "docs/b.md"]));
			expect(audit.diagnostics).toEqual([]);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("still fails the merged result when a shared dependency changed on another branch", async () => {
		const root = sharedDependencyRepo();
		try {
			git(root, "checkout", "-q", "-b", "deps", "main");
			writeFileSync(join(root, "src/example.ts"), "export function runThing() { return 2; }\n");
			attestDocuments({ root, paths: ["docs/a.md"] });
			git(root, "commit", "-q", "-am", "change code, review a only");
			git(root, "checkout", "-q", "main");
			git(root, "merge", "-q", "--no-edit", "deps");
			const audit = await evaluateAudit(batchAuditOptions(root, ["docs/a.md", "docs/b.md"]));
			expect(audit.diagnostics.map((item) => [item.file, item.code])).toEqual([
				["docs/b.md", "review-dependency-changed"],
			]);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});
