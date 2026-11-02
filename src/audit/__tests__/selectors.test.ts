import { describe, expect, it } from "bun:test";
import { resolveSelector, selectedRegion, selectorKind } from "../core/selectors.ts";

const SOURCE = `import { x } from "./x.ts";

/** Parses argv. */
export function parseArgs(argv: string[]): string[] {
	return argv;
}

export const settings = {
	strict: true,
	paths: [],
};

export class Runner {
	run(): void {}
	stop(): void {}
}

export interface Options {
	verbose: boolean;
}

export type Mode = "a" | "b";
`;

const DOC = `# Guide

Intro.

## Install

Run it.

### Details

More.

## Usage

Use it.
`;

describe("selectorKind", () => {
	it("chooses the resolver from the target file", () => {
		expect(selectorKind("package.json", "scripts.test")).toBe("json-key");
		expect(selectorKind("docs/a.md", "install")).toBe("heading");
		expect(selectorKind("src/a.ts", "L3-L9")).toBe("line");
		expect(selectorKind("src/a.ts", "parseArgs")).toBe("symbol");
		expect(selectorKind("scripts/run.py", "main")).toBe("symbol");
	});
});

describe("resolveSelector", () => {
	it("resolves dotted JSON key paths", () => {
		const json = JSON.stringify({ scripts: { test: "bun test" }, files: ["a"] });
		expect(resolveSelector("package.json", json, "scripts.test")).toEqual({ ok: true });
		expect(resolveSelector("package.json", json, "files.0")).toEqual({ ok: true });
		expect(resolveSelector("package.json", json, "scripts.lint")).toEqual({
			ok: false,
			reason: "no key scripts.lint",
		});
		expect(resolveSelector("package.json", "{", "scripts")).toEqual({
			ok: false,
			reason: "not valid JSON",
		});
	});

	it("resolves headings by GitHub slug", () => {
		expect(resolveSelector("a.md", DOC, "install")).toEqual({ ok: true });
		expect(resolveSelector("a.md", DOC, "Install")).toEqual({ ok: true });
		expect(resolveSelector("a.md", DOC, "setup")).toEqual({
			ok: false,
			reason: "no heading #setup",
		});
	});

	it("resolves line ranges within the file", () => {
		expect(resolveSelector("src/a.ts", SOURCE, "L4")).toEqual({ ok: true });
		expect(resolveSelector("src/a.ts", SOURCE, "L4-L6")).toEqual({ ok: true });
		expect(resolveSelector("src/a.ts", SOURCE, "L900").ok).toBe(false);
		expect(resolveSelector("src/a.ts", SOURCE, "L6-L4").ok).toBe(false);
	});

	it("resolves symbols as whole words in any language", () => {
		expect(resolveSelector("src/a.ts", SOURCE, "parseArgs")).toEqual({ ok: true });
		expect(resolveSelector("src/a.ts", SOURCE, "Runner.stop")).toEqual({ ok: true });
		expect(resolveSelector("src/a.ts", SOURCE, "parse")).toEqual({
			ok: false,
			reason: "no symbol parse",
		});
		expect(resolveSelector("run.py", "def main():\n    pass\n", "main")).toEqual({ ok: true });
	});
});

describe("selectedRegion", () => {
	it("narrows a JSON key to its canonical value", () => {
		const json = JSON.stringify({ scripts: { test: "x", lint: "y" } });
		expect(selectedRegion("package.json", json, "scripts")).toEqual({
			text: '{"lint":"y","test":"x"}',
			narrowed: true,
		});
		expect(selectedRegion("package.json", json, "bin")).toBeNull();
	});

	it("narrows a heading to its section, nested headings included", () => {
		const region = selectedRegion("a.md", DOC, "install");
		expect(region?.narrowed).toBe(true);
		expect(region?.text).toContain("Run it.");
		expect(region?.text).toContain("More.");
		expect(region?.text).not.toContain("Use it.");
	});

	it("narrows JS/TS declarations, JSDoc included", () => {
		expect(selectedRegion("src/a.ts", SOURCE, "parseArgs")).toEqual({
			text: "/** Parses argv. */\nexport function parseArgs(argv: string[]): string[] {\n\treturn argv;\n}",
			narrowed: true,
		});
		expect(selectedRegion("src/a.ts", SOURCE, "settings.strict")?.text).toBe("strict: true");
		expect(selectedRegion("src/a.ts", SOURCE, "Runner.stop")?.text).toBe("stop(): void {}");
		expect(selectedRegion("src/a.ts", SOURCE, "Options")?.text).toContain("verbose: boolean;");
		expect(selectedRegion("src/a.ts", SOURCE, "Mode")?.text).toBe('export type Mode = "a" | "b";');
		expect(selectedRegion("src/a.ts", SOURCE, "settings")?.text).toStartWith(
			"export const settings = {",
		);
	});

	it("falls back to the whole file when a symbol cannot be narrowed", () => {
		expect(selectedRegion("src/a.ts", SOURCE, "x")).toEqual({ text: SOURCE, narrowed: false });
		const python = "def main():\n    pass\n";
		expect(selectedRegion("run.py", python, "main")).toEqual({ text: python, narrowed: false });
	});

	it("is null when the selector names nothing", () => {
		expect(selectedRegion("src/a.ts", SOURCE, "missing")).toBeNull();
	});
});
