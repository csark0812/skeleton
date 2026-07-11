import { describe, expect, it } from "bun:test";
import { loadConfig } from "../config/load.ts";
import { findRepoRoot } from "../config/load.ts";

describe("loadConfig", () => {
	it("loads dogfood config from repo root", () => {
		const root = findRepoRoot();
		const config = loadConfig(root);
		expect(config.scan.include.length).toBeGreaterThan(0);
		expect(config.daysUntilStale).toBe(180);
		expect(config).not.toHaveProperty("staleReviewDays");
		expect(config).not.toHaveProperty("hubReadmes");
	});

	it("rejects invalid config", () => {
		expect(() => loadConfig("/nonexistent")).toThrow();
	});
});
