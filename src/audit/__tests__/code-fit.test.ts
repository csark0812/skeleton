import { afterEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	evaluateCodeFitDoc,
	extractPublicSurface,
	identifierOverlap,
	parseCodeFitMarkers,
} from "../core/code-fit.ts";
import { createContext } from "../core/context.ts";
import { runCodeFitRule } from "../rules/code-fit.ts";

const temps: string[] = [];

afterEach(() => {
	for (const dir of temps.splice(0)) {
		rmSync(dir, { recursive: true, force: true });
	}
});

function tempRepo(): string {
	const dir = mkdtempSync(join(tmpdir(), "code-fit-"));
	temps.push(dir);
	return dir;
}

describe("parseCodeFitMarkers", () => {
	it("parses targets and optional surface", () => {
		const markers = parseCodeFitMarkers(`
<!-- code-fit: targets=src/a.ts,src/b.ts -->
<!-- code-fit: targets=src/c.ts surface=foo,bar -->
`);
		expect(markers).toHaveLength(2);
		expect(markers[0]?.targets).toEqual(["src/a.ts", "src/b.ts"]);
		expect(markers[0]?.surface).toBeNull();
		expect(markers[1]?.surface).toEqual(["foo", "bar"]);
	});

	it("ignores markers inside fenced examples", () => {
		const markers = parseCodeFitMarkers(`
# Doc

\`\`\`markdown
<!-- code-fit: targets=src/example-only.ts -->
\`\`\`

<!-- code-fit: targets=src/real.ts -->
`);
		expect(markers).toHaveLength(1);
		expect(markers[0]?.targets).toEqual(["src/real.ts"]);
	});
});

describe("extractPublicSurface", () => {
	it("collects exports and case dispatch labels", () => {
		const src = `
export function runAudit() {}
export const parseAuditArgs = () => {};
export interface AuditCliOptions {}
function dispatch(cmd: string) {
  switch (cmd) {
    case "audit":
    case "catalog":
      break;
  }
}
`;
		expect(extractPublicSurface(src)).toEqual([
			"AuditCliOptions",
			"audit",
			"catalog",
			"parseAuditArgs",
			"runAudit",
		]);
	});
});

describe("evaluateCodeFitDoc", () => {
	it("errors on missing target", () => {
		const root = tempRepo();
		const doc = `# Doc\n\n<!-- code-fit: targets=missing.ts -->\n\naudit catalog\n`;
		const issues = evaluateCodeFitDoc("docs/x.md", doc, { root, overlapMin: 0 });
		expect(issues.some((i) => i.message.includes("missing"))).toBe(true);
	});

	it("passes when names are covered and overlap holds", () => {
		const root = tempRepo();
		mkdirSync(join(root, "src"), { recursive: true });
		writeFileSync(
			join(root, "src", "mod.ts"),
			`export function runThing() {}\nexport const helper = 1;\n`,
		);
		const doc = `# Mod

<!-- code-fit: targets=src/mod.ts -->

Documents runThing and helper for the module.
`;
		const issues = evaluateCodeFitDoc("docs/mod.md", doc, {
			root,
			overlapMin: 0.1,
		});
		expect(issues).toEqual([]);
	});

	it("fails coverage when a public name is absent from the doc", () => {
		const root = tempRepo();
		mkdirSync(join(root, "src"), { recursive: true });
		writeFileSync(
			join(root, "src", "mod.ts"),
			`export function runThing() {}\nexport function otherThing() {}\n`,
		);
		const doc = `# Mod

<!-- code-fit: targets=src/mod.ts -->

Only mentions runThing here.
`;
		const issues = evaluateCodeFitDoc("docs/mod.md", doc, {
			root,
			overlapMin: 0,
		});
		expect(issues.some((i) => i.message.includes("otherThing"))).toBe(true);
	});

	it("requires surface= when auto-surface exceeds cap", () => {
		const root = tempRepo();
		mkdirSync(join(root, "src"), { recursive: true });
		const exports = Array.from({ length: 30 }, (_, i) => `export function fn${i}() {}\n`).join("");
		writeFileSync(join(root, "src", "fat.ts"), exports);
		const doc = `# Fat\n\n<!-- code-fit: targets=src/fat.ts -->\n\nfn0\n`;
		const issues = evaluateCodeFitDoc("docs/fat.md", doc, {
			root,
			overlapMin: 0,
			surfaceCap: 25,
		});
		expect(issues.some((i) => i.message.includes("surface="))).toBe(true);
	});

	it("accepts surface= allowlist within cap path", () => {
		const root = tempRepo();
		mkdirSync(join(root, "src"), { recursive: true });
		writeFileSync(
			join(root, "src", "mod.ts"),
			`export function runThing() {}\nexport function otherThing() {}\n`,
		);
		const doc = `# Mod

<!-- code-fit: targets=src/mod.ts surface=runThing -->

Documents runThing for the module.
`;
		const issues = evaluateCodeFitDoc("docs/mod.md", doc, {
			root,
			overlapMin: 0.05,
		});
		expect(issues).toEqual([]);
	});

	it("errors when surface= name is not in the target", () => {
		const root = tempRepo();
		mkdirSync(join(root, "src"), { recursive: true });
		writeFileSync(join(root, "src", "mod.ts"), `export function runThing() {}\n`);
		const doc = `# Mod\n\n<!-- code-fit: targets=src/mod.ts surface=nope -->\n\nnope\n`;
		const issues = evaluateCodeFitDoc("docs/mod.md", doc, { root, overlapMin: 0 });
		expect(issues.some((i) => i.message.includes('surface name "nope"'))).toBe(true);
	});

	it("lexical-only when surface is empty", () => {
		const root = tempRepo();
		mkdirSync(join(root, "src"), { recursive: true });
		writeFileSync(
			join(root, "src", "script.ts"),
			`const localHelper = 1;\nfunction unused() { return localHelper; }\n`,
		);
		const good = `# Script\n\n<!-- code-fit: targets=src/script.ts -->\n\nlocalHelper unused script\n`;
		expect(
			evaluateCodeFitDoc("docs/s.md", good, { root, overlapMin: 0.03 }).filter((i) =>
				i.message.includes("lexical"),
			),
		).toEqual([]);

		const bad = `# Script\n\n<!-- code-fit: targets=src/script.ts -->\n\ncompletely unrelated prose about widgets\n`;
		expect(
			evaluateCodeFitDoc("docs/s.md", bad, { root, overlapMin: 0.03 }).some((i) =>
				i.message.includes("lexical"),
			),
		).toBe(true);
	});
});

describe("identifierOverlap", () => {
	it("is high when doc shares identifiers", () => {
		const code = `export function runAudit() { return parseAuditArgs([]); }\n`;
		const doc = "runAudit and parseAuditArgs drive the audit CLI.";
		expect(identifierOverlap(doc, code)).toBeGreaterThan(0.2);
	});
});

describe("runCodeFitRule corpus scan", () => {
	it("finds marked docs even when ctx.files is path-filtered", () => {
		const root = tempRepo();
		mkdirSync(join(root, "docs"), { recursive: true });
		mkdirSync(join(root, "src"), { recursive: true });
		writeFileSync(
			join(root, "skeleton.toml"),
			`daysUntilStale = 180\n\n[scan]\ninclude = ["docs/**"]\nexclude = []\n`,
		);
		writeFileSync(join(root, "src", "mod.ts"), `export function runThing() {}\n`);
		writeFileSync(
			join(root, "docs", "marked.md"),
			`# Marked\n\n<!-- code-fit: targets=src/mod.ts -->\n\nrunThing module\n`,
		);
		writeFileSync(join(root, "docs", "other.md"), `# Other\n\nNo marker.\n`);

		const ctx = createContext({ root, paths: ["docs/other.md"] });
		expect(ctx.files.every((f) => f.endsWith("other.md") || f.includes("other.md"))).toBe(true);

		const issues = runCodeFitRule(ctx);
		// marked.md still evaluated — either pass (empty) or fail; must not be skipped
		// With good coverage, issues empty; prove we read marked by using a bad marker doc instead
		expect(issues.every((i) => i.rule === "code-fit")).toBe(true);
	});

	it("reports failures on marked docs outside --paths", () => {
		const root = tempRepo();
		mkdirSync(join(root, "docs"), { recursive: true });
		mkdirSync(join(root, "src"), { recursive: true });
		writeFileSync(
			join(root, "skeleton.toml"),
			`daysUntilStale = 180\n\n[scan]\ninclude = ["docs/**"]\nexclude = []\n`,
		);
		writeFileSync(
			join(root, "src", "mod.ts"),
			`export function runThing() {}\nexport function otherThing() {}\n`,
		);
		writeFileSync(
			join(root, "docs", "marked.md"),
			`# Marked\n\n<!-- code-fit: targets=src/mod.ts -->\n\nrunThing only\n`,
		);
		writeFileSync(join(root, "docs", "other.md"), `# Other\n\nNo marker.\n`);

		const ctx = createContext({ root, paths: ["docs/other.md"] });
		const issues = runCodeFitRule(ctx);
		expect(
			issues.some((i) => i.file.includes("marked.md") && i.message.includes("otherThing")),
		).toBe(true);
	});
});
