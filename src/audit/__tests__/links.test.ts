import { describe, expect, it } from "bun:test";
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

	it("flags retired skill references", () => {
		const ctx = createContext({ root: FIXTURES });
		ctx.retiredSkills = new Set(["code-review"]);
		ctx.files = [join(FIXTURES, "retired-link.md")];
		const issues = runLinksRule(ctx);
		expect(issues.some((i) => i.message.includes("retired skill"))).toBe(true);
	});
});
