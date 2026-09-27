import { describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { interventionDigest } from "../../scripts/efficacy/intervention.ts";

describe("qualification intervention identity", () => {
	it("covers shipped runtime and guidance while excluding evidence-only documentation", () => {
		const root = mkdtempSync(join(tmpdir(), "skeleton-intervention-"));
		try {
			for (const directory of ["dist", "templates", "schemas", "skeleton", "docs"])
				mkdirSync(join(root, directory), { recursive: true });
			writeFileSync(join(root, "dist/cli.js"), "runtime-v1");
			writeFileSync(join(root, "templates/guide.md"), "guide-v1");
			writeFileSync(join(root, "schemas/config.json"), "{}");
			writeFileSync(join(root, "skeleton/SKILL.md"), "skill-v1");
			writeFileSync(join(root, "docs/evidence.md"), "before");

			const before = interventionDigest(root);
			writeFileSync(join(root, "docs/evidence.md"), "after");
			expect(interventionDigest(root)).toEqual(before);

			writeFileSync(join(root, "dist/cli.js"), "runtime-v2");
			expect(interventionDigest(root).digest).not.toBe(before.digest);
			expect(before.files).toBe(4);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});
