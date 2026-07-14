import { describe, expect, it } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");

describe("repo smoke", () => {
	it("ships the CLI entrypoint and package skill", () => {
		expect(existsSync(join(root, "src/cli.ts"))).toBe(true);
		expect(existsSync(join(root, "skeleton/SKILL.md"))).toBe(true);
		expect(existsSync(join(root, "package.json"))).toBe(true);
	});
});
