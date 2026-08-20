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
		expect(config.daysUntilStale).toBe(365);
		expect(config).not.toHaveProperty("staleReviewDays");
		expect(config).not.toHaveProperty("hubReadmes");
	});

	it("prefers skeleton.toml over legacy yaml", () => {
		const dir = join(tmpdir(), `skel-dual-config-${Date.now()}`);
		mkdirSync(join(dir, ".skeleton"), { recursive: true });
		writeFileSync(
			join(dir, "skeleton.toml"),
			`daysUntilStale = 365

[scan]
include = ["docs/**"]
exclude = []
`,
		);
		writeFileSync(
			join(dir, ".skeleton/config.yaml"),
			`scan:\n  include: ["other/**"]\n  exclude: []\ndaysUntilStale: 90\n`,
		);
		try {
			const config = loadConfig(dir);
			expect(config.scan.include).toEqual(["docs/**"]);
			expect(config.daysUntilStale).toBe(365);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("rejects invalid config", () => {
		expect(() => loadConfig("/nonexistent")).toThrow();
	});

	it("accepts skillOwnership config", () => {
		const dir = join(tmpdir(), `skel-ownership-config-${Date.now()}`);
		mkdirSync(join(dir, ".skeleton"), { recursive: true });
		writeFileSync(
			join(dir, ".skeleton/config.yaml"),
			`scan:\n  include: ["docs/**"]\n  exclude: []\ndaysUntilStale: 180\nskillOwnership:\n  lockfile: skills-lock.json\n  ownedSlugs: [mine]\n  foreignSlugs: [other]\n`,
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

	it("accepts hash review proof config", () => {
		const dir = join(tmpdir(), `skel-review-proof-config-${Date.now()}`);
		mkdirSync(join(dir, ".skeleton"), { recursive: true });
		writeFileSync(
			join(dir, "skeleton.toml"),
			`daysUntilStale = 180\n[scan]\ninclude = ["docs/**"]\nexclude = []\n[reviewProof]\nmode = "hash"\nlockfile = ".skeleton/custom-review-lock.json"\n`,
		);
		try {
			const config = loadConfig(dir);
			expect(config.reviewProof).toEqual({
				mode: "hash",
				lockfile: ".skeleton/custom-review-lock.json",
			});
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("rejects invalid skillOwnership slug patterns", () => {
		const dir = join(tmpdir(), `skel-ownership-bad-${Date.now()}`);
		mkdirSync(join(dir, ".skeleton"), { recursive: true });
		writeFileSync(
			join(dir, ".skeleton/config.yaml"),
			`scan:\n  include: ["docs/**"]\n  exclude: []\ndaysUntilStale: 180\nskillOwnership:\n  ownedSlugs: ["Bad_Slug"]\n`,
		);
		try {
			expect(() => loadConfig(dir)).toThrow(/Invalid/);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
