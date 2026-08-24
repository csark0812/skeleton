import { describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { attestDocuments, formatLocalReviewDate } from "../core/review-proof.ts";
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

describe("hash-backed review proof", () => {
	it("uses the operator's local calendar date", () => {
		expect(formatLocalReviewDate(new Date(2026, 7, 19, 23, 30))).toBe("2026-08-19");
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
