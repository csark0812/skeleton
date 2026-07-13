import { describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveCustomize } from "../resolve.ts";

function writeConfig(root: string, alwaysInclude: string[]): void {
	mkdirSync(join(root, ".skeleton"), { recursive: true });
	const always =
		alwaysInclude.length > 0
			? `\ncustomize:\n  alwaysInclude:\n${alwaysInclude.map((n) => `    - ${n}`).join("\n")}\n`
			: "\n";
	writeFileSync(
		join(root, ".skeleton", "config.yaml"),
		`scan:\n  include:\n    - "docs/**"\n  exclude: []\n  banned: []\ndaysUntilStale: 180${always}`,
	);
	writeFileSync(join(root, ".skeleton", "registry.md"), "# Registry\n");
}

describe("resolveCustomize alwaysInclude", () => {
	it("concatenates slug customize and alwaysInclude", () => {
		const root = mkdtempSync(join(tmpdir(), "skeleton-customize-"));
		try {
			writeConfig(root, ["shared-agent-references.md"]);
			mkdirSync(join(root, ".skeleton", "customize"), { recursive: true });
			writeFileSync(join(root, ".skeleton", "customize", "code-review.md"), "# slug\n");
			writeFileSync(
				join(root, ".skeleton", "customize", "shared-agent-references.md"),
				"# shared\n",
			);

			const result = resolveCustomize(root, "code-review");
			expect(result.content).toContain("# slug");
			expect(result.content).toContain("# shared");
			expect(result.content).toContain("---");
			expect(result.included).toEqual([
				".skeleton/customize/code-review.md",
				".skeleton/customize/shared-agent-references.md",
			]);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("injects alwaysInclude when slug file is missing", () => {
		const root = mkdtempSync(join(tmpdir(), "skeleton-customize-"));
		try {
			writeConfig(root, ["shared-agent-references.md"]);
			mkdirSync(join(root, ".skeleton", "customize"), { recursive: true });
			writeFileSync(
				join(root, ".skeleton", "customize", "shared-agent-references.md"),
				"# shared only\n",
			);

			const result = resolveCustomize(root, "brand-design");
			expect(result.content).toContain("# shared only");
			expect(result.included).toEqual([".skeleton/customize/shared-agent-references.md"]);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("returns null when neither slug nor alwaysInclude resolve", () => {
		const root = mkdtempSync(join(tmpdir(), "skeleton-customize-"));
		try {
			writeConfig(root, ["missing.md"]);
			mkdirSync(join(root, ".skeleton", "customize"), { recursive: true });

			const result = resolveCustomize(root, "missing-slug");
			expect(result.content).toBeNull();
			expect(result.included).toEqual([]);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});
