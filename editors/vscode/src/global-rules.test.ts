import { describe, expect, it } from "bun:test";
import { GLOBAL_RULE_IDS, mergePathScopedDiagnostics } from "./global-rules.ts";

describe("mergePathScopedDiagnostics", () => {
	it("preserves global-rule diagnostics and replaces path-scoped ones", () => {
		const existing = [
			{ code: "skill-index", message: "global" },
			{ code: "links", message: "old link" },
			{ code: "prose-policy", message: "old prose" },
		];
		const incoming = [
			{ code: "links", message: "new link" },
			{ code: "doc-meta", message: "meta" },
		];
		expect(
			mergePathScopedDiagnostics(existing, incoming, (d) =>
				typeof d.code === "string" ? d.code : undefined,
			),
		).toEqual([
			{ code: "skill-index", message: "global" },
			{ code: "links", message: "new link" },
			{ code: "doc-meta", message: "meta" },
		]);
	});

	it("clears path-scoped diagnostics when the file is clean but keeps globals", () => {
		const existing = [
			{ code: "registry", message: "global" },
			{ code: "links", message: "fixed" },
		];
		expect(
			mergePathScopedDiagnostics(existing, [], (d) =>
				typeof d.code === "string" ? d.code : undefined,
			),
		).toEqual([{ code: "registry", message: "global" }]);
	});

	it("lists the core global rule ids", () => {
		expect(GLOBAL_RULE_IDS.has("skill-index")).toBe(true);
		expect(GLOBAL_RULE_IDS.has("links")).toBe(false);
	});
});
