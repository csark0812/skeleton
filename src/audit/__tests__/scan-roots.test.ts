import { describe, expect, it } from "bun:test";
import { join } from "node:path";
import { createContext } from "../core/context.ts";
import { runScanRootsRule } from "../rules/scan-roots.ts";

const FIXTURES = join(import.meta.dir, "fixtures");

describe("scan-roots rule", () => {
	it("reports missing declared scan trees", () => {
		const ctx = createContext({ root: FIXTURES });
		ctx.config = {
			...ctx.config,
			scan: { ...ctx.config.scan, include: ["missing-dir/**", "docs/**"] },
		};
		const issues = runScanRootsRule(ctx);
		expect(issues.some((i) => i.file === "missing-dir")).toBe(true);
	});
});
