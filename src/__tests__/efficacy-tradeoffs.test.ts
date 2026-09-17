import { describe, expect, it } from "bun:test";
import {
	cpSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Run } from "@post-print/agent-test";
import { sequenceTokens } from "../../scripts/efficacy/adoption.ts";
import { documentationEvidence } from "../../scripts/efficacy/documents.ts";
import { assessRun } from "../../scripts/efficacy/measurements.ts";
import { checkOrderLimits } from "../../scripts/efficacy/order-checks.ts";
import { verifyCode } from "../../scripts/efficacy/verification.ts";
import { evaluateContext } from "../context.ts";

const FIXTURES = join(import.meta.dir, "../../tests/fixtures/efficacy");
const snapshot = (before: string, after: string) =>
	({ workspace: { initial: { path: before }, final: { path: after } } }) as Pick<Run, "workspace">;

describe("package tradeoff fixtures and evidence", () => {
	it("starts adoption without a guide, configuration, or free ownership metadata", () => {
		const root = join(FIXTURES, "tradeoffs/adoption/skeleton");
		expect(existsSync(join(root, "vendor/skeleton.tgz"))).toBe(true);
		expect(existsSync(join(root, "skeleton.toml"))).toBe(false);
		expect(readFileSync(join(root, "AGENTS.md"), "utf8")).not.toContain("skeleton: context-guide");
		expect(readFileSync(join(root, "docs/orders.md"), "utf8")).not.toContain("source-of-truth");
	});
	it("omits the load-bearing definition from the truncated bundle", () => {
		const root = join(FIXTURES, "tradeoffs/truncated/skeleton");
		const context = evaluateContext({ root, query: "order limit" });
		const excerpt = context.documents
			.flatMap((document) => document.sources)
			.find((source) => source.path === "src/limits.ts")?.excerpt;
		expect(excerpt).toContain("LIMITS[kind]");
		expect(excerpt).not.toContain("standard: 20");
		expect(readFileSync(join(root, "src/limits.ts"), "utf8")).toContain("standard: 20");
	});
	it("returns no context for the metadata-free recovery task", () => {
		const root = join(FIXTURES, "tradeoffs/missing/skeleton");
		expect(evaluateContext({ root, query: "order limit" }).documents).toEqual([]);
		expect(readFileSync(join(root, "AGENTS.md"), "utf8")).toContain("skeleton: context-guide");
	});
	it("uses actual initialization for authority without teaching a custom decision algorithm", () => {
		for (const variant of ["unmarked", "single-marker", "duplicate-markers"]) {
			const root = join(FIXTURES, "conflict", variant);
			const guide = readFileSync(join(root, "AGENTS.md"), "utf8");
			expect(guide).toContain("skeleton: context-guide");
			expect(guide).not.toContain("no matching marker:");
			expect(guide).not.toContain("one matching marker:");
			expect(existsSync(join(root, "node_modules/@csark0812/skeleton/dist/cli.js"))).toBe(true);
			expect(readFileSync(join(root, "package.json"), "utf8")).toContain("validate:changed");
			expect(existsSync(join(root, ".pre-commit-config.yaml"))).toBe(true);
		}
	});
	it("rejects a fallback-only patch and accepts the actual standard-limit fix", () => {
		const root = mkdtempSync(join(tmpdir(), "order-regression-"));
		try {
			cpSync(join(FIXTURES, "tradeoffs/truncated/control/src"), join(root, "src"), {
				recursive: true,
			});
			const path = join(root, "src/limits.ts");
			const before = readFileSync(path, "utf8");
			writeFileSync(path, before.replace("?? 20", "?? 30"));
			expect(checkOrderLimits(snapshot(root, root)).passed).toBe(false);
			writeFileSync(path, before.replace("standard: 20", "standard: 30"));
			expect(checkOrderLimits(snapshot(root, root)).passed).toBe(true);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
	it("reads final documentation and deletion from snapshots independent of the transcript", () => {
		const root = mkdtempSync(join(tmpdir(), "doc-evidence-"));
		const before = join(root, "before");
		const after = join(root, "after");
		mkdirSync(before);
		mkdirSync(after);
		try {
			writeFileSync(join(before, "doc.md"), "No retries.\n");
			writeFileSync(join(after, "doc.md"), "One retry.\n");
			const evidence = documentationEvidence(snapshot(before, after), "doc.md");
			expect(evidence.after).toBe("One retry.\n");
			expect(evidence.diff).toContain("-No retries.");
			expect(evidence.diff).toContain("+One retry.");
			rmSync(join(after, "doc.md"));
			expect(documentationEvidence(snapshot(before, after), "doc.md").after).toBeNull();
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
	it("includes both adoption and continuation tokens and fails closed on missing phase usage", () => {
		expect(
			sequenceTokens([{ usage: { tokens: { total: 120 } } }, { usage: { tokens: { total: 80 } } }]),
		).toBe(200);
		expect(
			sequenceTokens([{ usage: { tokens: {} } }, { usage: { tokens: { total: 80 } } }]),
		).toBeUndefined();
	});
	it("counts deleted required source as incorrect work, not an evaluation error", async () => {
		const root = mkdtempSync(join(tmpdir(), "missing-source-"));
		try {
			const run = {
				...snapshot(root, root),
				id: "deleted-source",
				durationMs: 1,
				usage: { tokens: { total: 10 } },
			};
			const outcome = await assessRun({ status: "fulfilled", value: run }, async (value) => ({
				checks: { regression: checkOrderLimits(value).passed },
				reason: "Source was deleted",
			}));
			expect(outcome.status).toBe("incorrect");
			expect(verifyCode("change-code-without-doc-reminder", root)).toMatchObject({ passed: false });
			expect(verifyCode("change-code-without-doc-reminder", root)?.error).toBeUndefined();
			expect(() => checkOrderLimits(snapshot(root, join(root, "unavailable")))).toThrow(
				"snapshot is unavailable",
			);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});
