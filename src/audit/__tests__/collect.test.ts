import { describe, expect, it } from "bun:test";
import { mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
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
import { buildSkillIndex } from "../core/skill-roots.ts";

const FIXTURES = join(import.meta.dir, "fixtures");
const NESTED_SKILLS_CUSTOMIZE = join(FIXTURES, "nested-skills-customize");

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

	it("collects customize markdown without an explicit scan.include", () => {
		const config = loadConfig(NESTED_SKILLS_CUSTOMIZE);
		const files = collectScanFiles(config, NESTED_SKILLS_CUSTOMIZE);
		const rels = files.map((f) => f.replace(`${NESTED_SKILLS_CUSTOMIZE}/`, ""));
		expect(rels).toContain(".skeleton/customize/code-review.md");
	});

	it("dedupes a skill reached through a per-slug symlinked root", () => {
		const root = join(tmpdir(), `skeleton-symlink-${Date.now()}`);
		try {
			mkdirSync(join(root, ".agents/skills/foo"), { recursive: true });
			writeFileSync(
				join(root, ".agents/skills/foo/SKILL.md"),
				"# Foo\n\n**Source of truth for** foo.\n",
			);
			mkdirSync(join(root, ".claude/skills"), { recursive: true });
			symlinkSync("../../.agents/skills/foo", join(root, ".claude/skills/foo"));

			const config = {
				scan: { include: [".agents/skills/**"], exclude: [], banned: [] },
				daysUntilStale: 180,
			} as ReturnType<typeof loadConfig>;
			const files = collectScanFiles(config, root, buildSkillIndex(root));
			const skillMd = files.filter((f) => f.endsWith("foo/SKILL.md"));

			expect(skillMd).toHaveLength(1);
			expect(skillMd[0]).toContain(".agents/skills/foo/SKILL.md");
			expect(files.some((f) => f.includes(".claude/skills/foo"))).toBe(false);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("does not collect foreign github-locked skill trees via skill augments", () => {
		const root = join(tmpdir(), `skeleton-foreign-collect-${Date.now()}`);
		try {
			mkdirSync(join(root, ".claude/skills/foreign"), { recursive: true });
			mkdirSync(join(root, ".claude/skills/mine"), { recursive: true });
			mkdirSync(join(root, ".skeleton"), { recursive: true });
			mkdirSync(join(root, "docs"), { recursive: true });
			writeFileSync(
				join(root, ".skeleton/config.yaml"),
				`scan:\n  include: ["docs/**"]\n  exclude: []\n  banned: []\ndaysUntilStale: 180\n`,
			);
			writeFileSync(join(root, "docs/a.md"), "# A\n");
			writeFileSync(join(root, ".claude/skills/foreign/SKILL.md"), "foreign\n");
			writeFileSync(join(root, ".claude/skills/mine/SKILL.md"), "mine\n");
			writeFileSync(
				join(root, "skills-lock.json"),
				JSON.stringify({
					version: 1,
					skills: {
						foreign: { source: "org/toolbox", sourceType: "github" },
					},
				}),
			);
			const config = loadConfig(root);
			const files = collectScanFiles(config, root, buildSkillIndex(root, config.skillOwnership));
			const rels = files.map((f) => f.replace(`${root}/`, ""));
			expect(rels).toContain(".claude/skills/mine/SKILL.md");
			expect(rels).not.toContain(".claude/skills/foreign/SKILL.md");
			expect(rels).toContain("docs/a.md");
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("does not collect foreign skills matched by scan.include globs", () => {
		const root = join(tmpdir(), `skeleton-foreign-include-${Date.now()}`);
		try {
			mkdirSync(join(root, ".claude/skills/foreign"), { recursive: true });
			mkdirSync(join(root, ".claude/skills/mine"), { recursive: true });
			mkdirSync(join(root, ".skeleton"), { recursive: true });
			writeFileSync(
				join(root, ".skeleton/config.yaml"),
				`scan:\n  include: [".claude/skills/**"]\n  exclude: []\n  banned: []\ndaysUntilStale: 180\n`,
			);
			writeFileSync(join(root, ".claude/skills/foreign/SKILL.md"), "foreign\n");
			writeFileSync(join(root, ".claude/skills/mine/SKILL.md"), "mine\n");
			writeFileSync(
				join(root, "skills-lock.json"),
				JSON.stringify({
					version: 1,
					skills: {
						foreign: { source: "org/toolbox", sourceType: "github" },
					},
				}),
			);
			const config = loadConfig(root);
			const files = collectScanFiles(config, root, buildSkillIndex(root, config.skillOwnership));
			const rels = files.map((f) => f.replace(`${root}/`, ""));
			expect(rels).toContain(".claude/skills/mine/SKILL.md");
			expect(rels).not.toContain(".claude/skills/foreign/SKILL.md");
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
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
