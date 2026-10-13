import { afterEach, describe, expect, it, setSystemTime } from "bun:test";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { attestDocuments, formatUtcReviewDate } from "../core/review-proof.ts";
import { formatUtcReviewStamp, parseReviewStamp } from "../core/shared.ts";
import { evaluateAudit, parseAuditArgs } from "../run.ts";

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

[reviewProof]
mode = "hash"
`,
	);
	writeFileSync(join(root, "src/example.ts"), "export function runThing() { return 1; }\n");
	writeFileSync(
		join(root, "docs/example.md"),
		`# Example

<!-- source-of-truth: example command behavior -->

<!-- doc-meta: owner=eng | last-reviewed=2026-08-19 -->

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

function writeDoc(root: string, relPath: string, deps: string): void {
	writeFileSync(
		join(root, relPath),
		`# ${relPath}

<!-- source-of-truth: ${relPath} behavior -->

<!-- doc-meta: owner=eng | last-reviewed=2026-08-19 -->

<!-- review-deps: paths=${deps} -->

Body of ${relPath}.
`,
	);
}

function batchAuditOptions(root: string, paths: string[]) {
	return { ...auditOptions(root), paths };
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
	attestDocuments({ root, paths: ["docs/example.md"], reviewedAt: "2026-08-19" });
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

afterEach(() => {
	setSystemTime();
});

describe("review stamps", () => {
	it("formats a UTC timestamp with seconds", () => {
		expect(formatUtcReviewStamp(new Date("2026-08-19T23:30:05.678Z"))).toBe("2026-08-19T23:30:05Z");
	});

	it("parses legacy dates and UTC timestamps to a UTC day", () => {
		expect(parseReviewStamp("2026-08-19")).toEqual({
			day: "2026-08-19",
			instant: new Date("2026-08-19T00:00:00Z"),
			kind: "date",
		});
		expect(parseReviewStamp("2026-08-19T23:30:05Z")).toEqual({
			day: "2026-08-19",
			instant: new Date("2026-08-19T23:30:05Z"),
			kind: "timestamp",
		});
	});

	it("rejects invalid stamps", () => {
		for (const value of [
			"2026-13-40",
			"2026-02-30",
			"2026-08-19T24:00:00Z",
			"2026-08-19T12:60:00Z",
			"2026-08-19T12:00:60Z",
			"2026-08-19T12:00:00",
			"2026-08-19T12:00Z",
			"2026-08-19T12:00:00.000Z",
			"2026-08-19 12:00:00Z",
			"",
		]) {
			expect(parseReviewStamp(value)).toBeNull();
		}
	});
});

describe("hash-backed review proof", () => {
	it("uses the UTC calendar date", () => {
		expect(formatUtcReviewDate(new Date("2026-08-20T00:30:00.000Z"))).toBe("2026-08-20");
		expect(formatUtcReviewDate(new Date("2026-08-19T23:30:00.000Z"))).toBe("2026-08-19");
	});

	it("writes a UTC timestamp so a same-day re-review changes the document bytes", async () => {
		const root = makeRepo();
		try {
			const doc = join(root, "docs/example.md");
			setSystemTime(new Date("2026-08-19T10:00:00.400Z"));
			const first = attestDocuments({ root, paths: ["docs/example.md"] });
			expect(first.reviewedAt).toBe("2026-08-19T10:00:00Z");
			const firstBytes = readFileSync(doc, "utf8");
			expect(firstBytes).toContain("last-reviewed=2026-08-19T10:00:00Z -->");
			expect((await evaluateAudit(auditOptions(root))).exitCode).toBe(0);

			setSystemTime(new Date("2026-08-19T10:00:01.400Z"));
			attestDocuments({ root, paths: ["docs/example.md"] });
			const secondBytes = readFileSync(doc, "utf8");
			expect(secondBytes).not.toBe(firstBytes);
			expect(secondBytes).toContain("last-reviewed=2026-08-19T10:00:01Z -->");
			const lock = JSON.parse(readFileSync(join(root, ".skeleton/review-lock.json"), "utf8"));
			expect(lock.documents["docs/example.md"].reviewedAt).toBe("2026-08-19T10:00:01Z");
			expect((await evaluateAudit(auditOptions(root))).exitCode).toBe(0);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("rejects an invalid explicit review stamp", () => {
		const root = makeRepo();
		try {
			expect(() =>
				attestDocuments({ root, paths: ["docs/example.md"], reviewedAt: "2026-13-40" }),
			).toThrow(/Invalid review date/);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("binds the reviewed document and dependency bytes", async () => {
		const root = makeRepo();
		try {
			attestDocuments({ root, paths: ["docs/example.md"], reviewedAt: "2026-08-19" });
			const valid = await evaluateAudit(auditOptions(root));
			expect(valid.exitCode).toBe(0);
			expect(valid.reviewProof).toEqual({
				mode: "hash",
				status: "valid",
				lockfile: ".skeleton/review-lock.json",
			});

			writeFileSync(join(root, "src/example.ts"), "export function runThing() { return 2; }\n");
			const codeDrift = await evaluateAudit(auditOptions(root));
			expect(codeDrift.exitCode).toBe(1);
			expect(codeDrift.reviewProof.status).toBe("invalid");
			expect(codeDrift.diagnostics.some((item) => item.code === "review-dependency-changed")).toBe(
				true,
			);

			attestDocuments({ root, paths: ["docs/example.md"], reviewedAt: "2026-08-19" });
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

	for (const order of [
		["docs/a.md", "docs/b.md", "docs/c.md"],
		["docs/c.md", "docs/b.md", "docs/a.md"],
	]) {
		it(`binds dependencies on documents attested in the same run (${order.join(",")})`, async () => {
			const root = makeRepo();
			try {
				writeDoc(root, "docs/a.md", "docs/b.md");
				writeDoc(root, "docs/b.md", "docs/c.md");
				writeDoc(root, "docs/c.md", "src/example.ts");
				attestDocuments({ root, paths: order, reviewedAt: "2026-08-20T09:00:00Z" });

				const lock = JSON.parse(readFileSync(join(root, ".skeleton/review-lock.json"), "utf8"));
				const result = await evaluateAudit(batchAuditOptions(root, order));
				expect(result.diagnostics).toEqual([]);
				expect(result.exitCode).toBe(0);
				expect(lock.documents["docs/a.md"].reviewDependencies["docs/b.md"]).toBe(
					lock.documents["docs/b.md"].documentHash,
				);
				expect(lock.documents["docs/b.md"].reviewDependencies["docs/c.md"]).toBe(
					lock.documents["docs/c.md"].documentHash,
				);
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
			attestDocuments({ root, paths, reviewedAt: "2026-08-20T09:00:00Z" });
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

	it("accepts a raw-byte package.json digest recorded before the manifest rule", async () => {
		const root = makeManifestRepo("package.json");
		try {
			const lockPath = join(root, ".skeleton/review-lock.json");
			const lock = JSON.parse(readFileSync(lockPath, "utf8"));
			const rawBytes = readFileSync(join(root, "package.json"), "utf8");
			lock.documents["docs/example.md"].reviewDependencies["package.json"] =
				`sha256:${createHash("sha256").update(rawBytes, "utf8").digest("hex")}`;
			writeFileSync(lockPath, `${JSON.stringify(lock, null, "\t")}\n`);
			expect(await changedDependencies(root)).toEqual([]);
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

	it("refuses to overwrite malformed review evidence", () => {
		const root = makeRepo();
		try {
			mkdirSync(join(root, ".skeleton"), { recursive: true });
			writeFileSync(join(root, ".skeleton/review-lock.json"), "not json\n");
			expect(() =>
				attestDocuments({ root, paths: ["docs/example.md"], reviewedAt: "2026-08-19" }),
			).toThrow(/malformed/i);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("reports structurally malformed review evidence without throwing", async () => {
		const root = makeRepo();
		try {
			mkdirSync(join(root, ".skeleton"), { recursive: true });
			writeFileSync(
				join(root, ".skeleton/review-lock.json"),
				JSON.stringify({
					version: 2,
					documents: { "docs/example.md": { reviewedAt: "2026-08-19" } },
				}),
			);
			const result = await evaluateAudit(auditOptions(root));
			expect(result.exitCode).toBe(1);
			expect(result.diagnostics).toContainEqual(
				expect.objectContaining({ code: "review-proof-lock-invalid" }),
			);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});
