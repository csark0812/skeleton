import { describe, expect, it } from "bun:test";
import { gitFreshnessMessage } from "../rules/doc-meta.ts";

describe("doc-meta stale content message", () => {
	it("requires a full content review before changing last-reviewed", () => {
		expect(gitFreshnessMessage("2026-08-16", "2026-08-17")).toBe(
			"content changed after last-reviewed 2026-08-16 (git: 2026-08-17) — REQUIRED: re-read the entire document, then bump last-reviewed only if the content is still correct; do not change the date alone",
		);
	});
});
