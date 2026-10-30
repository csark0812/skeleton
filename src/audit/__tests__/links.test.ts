import { describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createContext } from "../core/context.ts";
import { runLinksRule } from "../rules/links.ts";

const FIXTURES = join(import.meta.dir, "fixtures");

describe("runLinksRule", () => {
	it("flags broken paths", () => {
		const ctx = createContext({ root: FIXTURES });
		ctx.files = [join(FIXTURES, "links-source.md"), join(FIXTURES, "target.md")];
		const issues = runLinksRule(ctx);
		expect(issues.some((i) => i.message.includes("broken link"))).toBe(true);
	});

	it("accepts valid reference anchors", () => {
		const ctx = createContext({ root: FIXTURES });
		ctx.files = [join(FIXTURES, "links-source.md"), join(FIXTURES, "target.md")];
		const issues = runLinksRule(ctx);
		expect(issues.some((i) => i.message.includes("broken anchor"))).toBe(false);
	});

	it("accepts public GitHub reference URLs without requiring a local copy", () => {
		const ctx = createContext({ root: FIXTURES });
		ctx.files = [join(FIXTURES, "github-reference.md")];
		expect(runLinksRule(ctx)).toEqual([]);
	});

	it("flags missing skill links", () => {
		const ctx = createContext({ root: FIXTURES });
		ctx.files = [join(FIXTURES, "retired-link.md")];
		const issues = runLinksRule(ctx);
		expect(issues.some((i) => i.message.includes("missing skill"))).toBe(true);
	});

	it("resolves anchors on code and JSON targets with their own selectors", () => {
		const root = mkdtempSync(join(tmpdir(), "skeleton-links-selectors-"));
		try {
			mkdirSync(join(root, "docs"), { recursive: true });
			mkdirSync(join(root, "src"), { recursive: true });
			writeFileSync(
				join(root, "skeleton.toml"),
				'daysUntilStale = 365\n[scan]\ninclude = ["docs/**"]\nexclude = []\n',
			);
			writeFileSync(join(root, "src/run.ts"), "export function parseArgs() {}\n");
			writeFileSync(join(root, "package.json"), JSON.stringify({ scripts: { test: "x" } }));
			writeFileSync(
				join(root, "docs/a.md"),
				[
					"[ok](../src/run.ts#parseArgs) [ok](../package.json#scripts.test) [ok](../src/run.ts#L1)",
					"[bad](../src/run.ts#parseArgv) [bad](../package.json#scripts.lint)",
				].join("\n"),
			);
			const ctx = createContext({ root });
			ctx.files = [join(root, "docs/a.md")];
			expect(runLinksRule(ctx).map((i) => i.message)).toEqual([
				"broken anchor → #parseArgv in src/run.ts: no symbol parseArgv",
				"broken anchor → #scripts.lint in package.json: no key scripts.lint",
			]);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});
