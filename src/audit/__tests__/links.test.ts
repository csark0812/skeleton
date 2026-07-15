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
		const broken = issues.find((i) => i.message.includes("broken link"));
		expect(broken?.range).toEqual({
			start: { line: 3, column: 39 },
			end: { line: 3, column: 51 },
		});
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
