import { describe, expect, it } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findRepoRoot, loadConfig } from "../config/load.ts";

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

	it("accepts skillOwnership config", () => {
		const dir = join(tmpdir(), `skel-ownership-config-${Date.now()}`);
		mkdirSync(join(dir, ".skeleton"), { recursive: true });
		writeFileSync(
			join(dir, ".skeleton/config.yaml"),
			`scan:\n  include: ["docs/**"]\n  exclude: []\n  banned: []\ndaysUntilStale: 180\nskillOwnership:\n  lockfile: skills-lock.json\n  ownedSlugs: [mine]\n  foreignSlugs: [other]\n`,
		);
		try {
			const config = loadConfig(dir);
			expect(config.skillOwnership?.lockfile).toBe("skills-lock.json");
			expect(config.skillOwnership?.ownedSlugs).toEqual(["mine"]);
			expect(config.skillOwnership?.foreignSlugs).toEqual(["other"]);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("rejects invalid skillOwnership slug patterns", () => {
		const dir = join(tmpdir(), `skel-ownership-bad-${Date.now()}`);
		mkdirSync(join(dir, ".skeleton"), { recursive: true });
		writeFileSync(
			join(dir, ".skeleton/config.yaml"),
			`scan:\n  include: ["docs/**"]\n  exclude: []\n  banned: []\ndaysUntilStale: 180\nskillOwnership:\n  ownedSlugs: ["Bad_Slug"]\n`,
		);
		try {
			expect(() => loadConfig(dir)).toThrow(/Invalid/);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
