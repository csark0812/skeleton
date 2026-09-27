import { afterEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { reserveQualificationRun } from "../../scripts/efficacy/run-lock.ts";

const roots: string[] = [];
afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("one-shot qualification output reservation", () => {
	it("reserves a fresh result directory and refuses a rerun", () => {
		const root = mkdtempSync(join(tmpdir(), "skeleton-qualification-lock-"));
		roots.push(root);
		const resultRoot = join(root, ".qualification-cache/results");
		reserveQualificationRun(resultRoot, join(root, "docs/evidence/broader-openai-v1.json"));
		expect(() => reserveQualificationRun(resultRoot, join(root, "evidence.json"))).toThrow(
			"refusing a rerun",
		);
	});

	it("refuses to replace an existing immutable evidence summary", () => {
		const root = mkdtempSync(join(tmpdir(), "skeleton-qualification-lock-"));
		roots.push(root);
		const resultRoot = join(root, ".qualification-cache/results");
		const evidencePath = join(root, "docs/evidence/broader-openai-v1.json");
		mkdirSync(join(root, "docs/evidence"), { recursive: true });
		writeFileSync(evidencePath, "immutable");
		expect(() => reserveQualificationRun(resultRoot, evidencePath)).toThrow(
			"refusing to overwrite",
		);
		expect(readFileSync(evidencePath, "utf8")).toBe("immutable");
	});
});
