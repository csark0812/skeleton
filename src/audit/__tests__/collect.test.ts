import { describe, expect, it } from "bun:test";
import { join } from "node:path";
import { loadConfig } from "../config/load.ts";
import {
	collectScanFiles,
	filterDocMetaPaths,
	filterToPaths,
	includeExplicitMarkdownPaths,
	validateScanRoots,
} from "../core/collect.ts";
import { matchesGlobScope, normalizeRelPath } from "../core/shared.ts";

const FIXTURES = join(import.meta.dir, "fixtures");

describe("normalizeRelPath", () => {
	it("strips leading ./ segments and normalizes slashes", () => {
		expect(normalizeRelPath("./.skeleton/plugins/x.yaml")).toBe(".skeleton/plugins/x.yaml");
		expect(normalizeRelPath(".\\.skeleton\\plugins\\x.yaml")).toBe(".skeleton/plugins/x.yaml");
		expect(normalizeRelPath("././docs/a.md")).toBe("docs/a.md");
	});

	it("leaves absolute paths unchanged aside from separators", () => {
		expect(normalizeRelPath("/tmp/repo/docs/a.md")).toBe("/tmp/repo/docs/a.md");
	});
});

describe("matchesGlobScope", () => {
	it("matches deploy doc globs", () => {
		expect(matchesGlobScope("apps/client/DEPLOYMENT.md", "**/DEPLOYMENT.md")).toBe(true);
		expect(matchesGlobScope("docs/README.md", "**/DEPLOYMENT.md")).toBe(false);
	});

	it("matches brace alternation", () => {
		expect(matchesGlobScope("apps/x/DEPLOYMENT.md", "**/{DEPLOYMENT,DISTRIBUTION}.md")).toBe(true);
		expect(matchesGlobScope("apps/x/DISTRIBUTION.md", "**/{DEPLOYMENT,DISTRIBUTION}.md")).toBe(
			true,
		);
	});
});

describe("collectScanFiles", () => {
	it("collects markdown under scan.include from fixture", () => {
		const config = loadConfig(FIXTURES);
		const files = collectScanFiles(config, FIXTURES);
		const rels = files.map((f) => f.replace(`${FIXTURES}/`, ""));
		expect(rels).toContain("docs/README.md");
		expect(rels).toContain("docs/developer/validation.md");
		expect(rels.some((r) => r.includes("packages/outlier"))).toBe(false);
	});
});

describe("validateScanRoots", () => {
	it("flags missing scan roots", () => {
		const config = loadConfig(FIXTURES);
		const missing = validateScanRoots(
			{
				...config,
				scan: { ...config.scan, include: ["missing-tree/**", "docs/**"] },
			},
			FIXTURES,
		);
		expect(missing).toContain("missing-tree");
		expect(missing).not.toContain("docs");
	});
});

describe("filterDocMetaPaths", () => {
	it("keeps only doc-meta paths matching explicit --paths", () => {
		const all = ["docs/a.md", "docs/dev/b.md", ".skeleton/registry.md"];
		expect(filterDocMetaPaths(all, ["docs/dev/b.md"])).toEqual(["docs/dev/b.md"]);
	});

	it("keeps doc-meta paths under a directory path", () => {
		const all = ["docs/dev/a.md", "docs/dev/b.md", ".skeleton/registry.md"];
		expect(filterDocMetaPaths(all, ["docs/dev"])).toEqual(["docs/dev/a.md", "docs/dev/b.md"]);
	});
});

describe("includeExplicitMarkdownPaths", () => {
	it("includes markdown files and expands directory paths", () => {
		const root = FIXTURES;
		const files: string[] = [];
		const included = includeExplicitMarkdownPaths(
			files,
			["docs/developer/validation.md", "docs"],
			root,
		);
		const rels = included.map((f) => f.replace(`${root}/`, ""));
		expect(rels).toContain("docs/developer/validation.md");
		expect(rels).toContain("docs/README.md");
	});
});

describe("filterToPaths", () => {
	it("keeps files matching explicit file paths", () => {
		const root = FIXTURES;
		const files = [`${root}/docs/a.md`, `${root}/docs/dev/b.md`, `${root}/apps/client/x.ts`];
		expect(filterToPaths(files, ["docs/dev/b.md"], root)).toEqual([`${root}/docs/dev/b.md`]);
	});

	it("matches ./prefixed explicit file and directory paths", () => {
		const root = FIXTURES;
		const files = [`${root}/docs/a.md`, `${root}/docs/dev/b.md`];
		expect(filterToPaths(files, ["./docs/dev/b.md"], root)).toEqual([`${root}/docs/dev/b.md`]);
		expect(filterToPaths(files, ["./docs/dev"], root)).toEqual([`${root}/docs/dev/b.md`]);
	});

	it("keeps files under directory paths", () => {
		const root = FIXTURES;
		const files = [`${root}/docs/a.md`, `${root}/docs/dev/b.md`];
		expect(filterToPaths(files, ["docs/dev"], root)).toEqual([`${root}/docs/dev/b.md`]);
	});
});
