import { describe, expect, it } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	buildSkillIndex,
	detectSkillRoots,
	isForeignSkillPath,
	isSkillPath,
	listSkillMarkdownPaths,
	resolveSkillPath,
	slugFromPath,
} from "../core/skill-roots.ts";

const FIXTURES = join(import.meta.dir, "fixtures");

describe("skill-roots", () => {
	it("detects flat root skill layout", () => {
		const flatRoot = join(FIXTURES, "flat-skill-root");
		const index = buildSkillIndex(flatRoot);
		expect(index.slugs).toContain("multi");
		expect(resolveSkillPath(index, flatRoot, "multi")).toBe("multi/SKILL.md");
	});

	it("detects nested .claude/skills layout", () => {
		const nestedSkills = join(FIXTURES, "nested-skills-customize");
		const index = buildSkillIndex(nestedSkills);
		expect(index.slugs).toContain("code-review");
		expect(resolveSkillPath(index, nestedSkills, "code-review")).toBe(
			".claude/skills/code-review/SKILL.md",
		);
	});

	it("classifies skill paths", () => {
		const nestedSkills = join(FIXTURES, "nested-skills-customize");
		const index = buildSkillIndex(nestedSkills);
		expect(isSkillPath(".claude/skills/code-review/SKILL.md", index)).toBe(true);
		expect(isSkillPath("docs/foo.md", index)).toBe(false);
	});

	it("extracts slug from SKILL.md path", () => {
		expect(slugFromPath(".claude/skills/testing/SKILL.md")).toBe("testing");
		expect(slugFromPath("multi/SKILL.md")).toBe("multi");
	});

	it("extracts slug from nested skill-tree references paths", () => {
		expect(slugFromPath(".claude/skills/crystallize/references/planning/build.md")).toBe(
			"crystallize",
		);
		expect(
			slugFromPath("/Users/me/repo/.agents/skills/code-review/references/task-prompt-review.md"),
		).toBe("code-review");
	});

	it("extracts slug from flat skill references when SKILL.md exists", () => {
		const flatRoot = join(FIXTURES, "flat-skill-root");
		expect(slugFromPath("multi/references/output-schema.md", flatRoot)).toBe("multi");
		expect(slugFromPath("docs/references/noop.md", flatRoot)).toBeNull();
	});

	it("excludes references and _shared under nested roots", () => {
		const nestedSkills = join(FIXTURES, "nested-skills-customize");
		const roots = detectSkillRoots(nestedSkills);
		const index = buildSkillIndex(nestedSkills);
		expect(index.slugs).not.toContain("references");
		expect(index.slugs).not.toContain("_shared");
		expect(roots.some((r) => r.relPath === ".claude/skills")).toBe(true);
	});

	it("lists all skill-tree markdown including references/", () => {
		const dir = join(tmpdir(), `skill-md-paths-${Date.now()}`);
		mkdirSync(join(dir, ".claude/skills/foo/references"), { recursive: true });
		writeFileSync(join(dir, ".claude/skills/foo/SKILL.md"), "---\nname: foo\n---\n");
		writeFileSync(join(dir, ".claude/skills/foo/references/note.md"), "# note\n");
		writeFileSync(join(dir, ".claude/skills/foo/references/extra.mdc"), "# extra\n");
		try {
			const paths = listSkillMarkdownPaths(dir, buildSkillIndex(dir));
			expect(paths).toContain(".claude/skills/foo/SKILL.md");
			expect(paths).toContain(".claude/skills/foo/references/note.md");
			expect(paths).toContain(".claude/skills/foo/references/extra.mdc");
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("lists same-slug trees under both .claude and .agents when not symlinked", () => {
		const dir = join(tmpdir(), `skill-dual-root-${Date.now()}`);
		mkdirSync(join(dir, ".claude/skills/foo/references"), { recursive: true });
		mkdirSync(join(dir, ".agents/skills/foo/references"), { recursive: true });
		writeFileSync(join(dir, ".claude/skills/foo/SKILL.md"), "claude body\n");
		writeFileSync(join(dir, ".claude/skills/foo/references/note.md"), "claude note\n");
		writeFileSync(join(dir, ".agents/skills/foo/SKILL.md"), "AGENTS_ONLY_TOKEN\n");
		writeFileSync(join(dir, ".agents/skills/foo/references/agents.md"), "agents note\n");
		try {
			const paths = listSkillMarkdownPaths(dir, buildSkillIndex(dir));
			expect(paths).toContain(".claude/skills/foo/SKILL.md");
			expect(paths).toContain(".claude/skills/foo/references/note.md");
			expect(paths).toContain(".agents/skills/foo/SKILL.md");
			expect(paths).toContain(".agents/skills/foo/references/agents.md");
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("classifies github lock skills as foreign and excludes them from markdown paths", () => {
		const dir = join(tmpdir(), `skill-ownership-${Date.now()}`);
		mkdirSync(join(dir, ".claude/skills/foreign"), { recursive: true });
		mkdirSync(join(dir, ".claude/skills/mine"), { recursive: true });
		writeFileSync(join(dir, ".claude/skills/foreign/SKILL.md"), "foreign\n");
		writeFileSync(join(dir, ".claude/skills/mine/SKILL.md"), "mine\n");
		writeFileSync(
			join(dir, "skills-lock.json"),
			JSON.stringify({
				version: 1,
				skills: {
					foreign: { source: "org/toolbox", sourceType: "github" },
				},
			}),
		);
		try {
			const index = buildSkillIndex(dir);
			expect(index.slugs.sort()).toEqual(["foreign", "mine"]);
			expect(index.ownedSlugs).toEqual(["mine"]);
			expect(index.foreignSlugs).toEqual(["foreign"]);
			const paths = listSkillMarkdownPaths(dir, index);
			expect(paths).toContain(".claude/skills/mine/SKILL.md");
			expect(paths).not.toContain(".claude/skills/foreign/SKILL.md");
			expect(isForeignSkillPath(".claude/skills/foreign/SKILL.md", index)).toBe(true);
			expect(isForeignSkillPath(".claude/skills/mine/SKILL.md", index)).toBe(false);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("honors ownedSlugs override for locked github skills", () => {
		const dir = join(tmpdir(), `skill-owned-override-${Date.now()}`);
		mkdirSync(join(dir, ".claude/skills/foreign"), { recursive: true });
		writeFileSync(join(dir, ".claude/skills/foreign/SKILL.md"), "foreign\n");
		writeFileSync(
			join(dir, "skills-lock.json"),
			JSON.stringify({
				version: 1,
				skills: {
					foreign: { source: "org/toolbox", sourceType: "github" },
				},
			}),
		);
		try {
			const index = buildSkillIndex(dir, { ownedSlugs: ["foreign"] });
			expect(index.ownedSlugs).toEqual(["foreign"]);
			expect(index.foreignSlugs).toEqual([]);
			expect(listSkillMarkdownPaths(dir, index)).toContain(".claude/skills/foreign/SKILL.md");
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("classifies all markdown under a flat foreign skill tree as foreign", () => {
		const dir = join(tmpdir(), `skill-flat-foreign-${Date.now()}`);
		mkdirSync(join(dir, "foreign-skill/references"), { recursive: true });
		mkdirSync(join(dir, "mine"), { recursive: true });
		writeFileSync(join(dir, "foreign-skill/SKILL.md"), "foreign\n");
		writeFileSync(join(dir, "foreign-skill/extra.md"), "# extra\n");
		writeFileSync(join(dir, "foreign-skill/references/note.md"), "# note\n");
		writeFileSync(join(dir, "mine/SKILL.md"), "mine\n");
		writeFileSync(join(dir, "mine/extra.md"), "# extra\n");
		writeFileSync(
			join(dir, "skills-lock.json"),
			JSON.stringify({
				version: 1,
				skills: {
					"foreign-skill": { source: "org/toolbox", sourceType: "github" },
				},
			}),
		);
		try {
			const index = buildSkillIndex(dir);
			// Non-SKILL.md / non-references markdown must still be foreign.
			expect(isForeignSkillPath("foreign-skill/extra.md", index)).toBe(true);
			expect(isForeignSkillPath("foreign-skill/SKILL.md", index)).toBe(true);
			expect(isForeignSkillPath("foreign-skill/references/note.md", index)).toBe(true);
			// Owned trees stay owned regardless of file position.
			expect(isForeignSkillPath("mine/extra.md", index)).toBe(false);
			expect(isForeignSkillPath("mine/SKILL.md", index)).toBe(false);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("does not classify docs/<foreign-slug>/ paths as skill or foreign", () => {
		const dir = join(tmpdir(), `skill-docs-collision-${Date.now()}`);
		mkdirSync(join(dir, "docs/code-review/references"), { recursive: true });
		mkdirSync(join(dir, ".claude/skills/code-review"), { recursive: true });
		writeFileSync(join(dir, "docs/code-review/references/note.md"), "# Note\n");
		writeFileSync(join(dir, "docs/code-review/SKILL.md"), "not a skill tree\n");
		writeFileSync(join(dir, ".claude/skills/code-review/SKILL.md"), "foreign\n");
		writeFileSync(
			join(dir, "skills-lock.json"),
			JSON.stringify({
				version: 1,
				skills: {
					"code-review": { source: "org/toolbox", sourceType: "github" },
				},
			}),
		);
		try {
			const index = buildSkillIndex(dir);
			expect(isSkillPath("docs/code-review/SKILL.md", index)).toBe(false);
			expect(isSkillPath("docs/code-review/references/note.md", index)).toBe(false);
			expect(isForeignSkillPath("docs/code-review/references/note.md", index)).toBe(false);
			expect(isForeignSkillPath(".claude/skills/code-review/SKILL.md", index)).toBe(true);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("does not let nested-only foreign slugs claim top-level dirs when a flat skill exists", () => {
		const dir = join(tmpdir(), `skill-flat-nested-collision-${Date.now()}`);
		mkdirSync(join(dir, "skeleton"), { recursive: true });
		mkdirSync(join(dir, ".claude/skills/code-review"), { recursive: true });
		mkdirSync(join(dir, ".claude/skills/multi"), { recursive: true });
		mkdirSync(join(dir, "code-review"), { recursive: true });
		mkdirSync(join(dir, "multi"), { recursive: true });
		writeFileSync(join(dir, "skeleton/SKILL.md"), "owned flat\n");
		writeFileSync(join(dir, ".claude/skills/code-review/SKILL.md"), "foreign nested\n");
		writeFileSync(join(dir, ".claude/skills/multi/SKILL.md"), "foreign nested\n");
		writeFileSync(join(dir, "code-review/notes.md"), "# not a skill tree\n");
		writeFileSync(join(dir, "multi/README.md"), "# not a skill tree\n");
		writeFileSync(
			join(dir, "skills-lock.json"),
			JSON.stringify({
				version: 1,
				skills: {
					"code-review": { source: "org/toolbox", sourceType: "github" },
					multi: { source: "org/toolbox", sourceType: "github" },
				},
			}),
		);
		try {
			const index = buildSkillIndex(dir);
			expect(index.flatSlugs).toEqual(["skeleton"]);
			expect(index.foreignSlugs.sort()).toEqual(["code-review", "multi"]);
			// Top-level dirs sharing nested foreign slug names must stay non-skill.
			expect(isSkillPath("code-review/notes.md", index)).toBe(false);
			expect(isForeignSkillPath("code-review/notes.md", index)).toBe(false);
			expect(isSkillPath("multi/README.md", index)).toBe(false);
			expect(isForeignSkillPath("multi/README.md", index)).toBe(false);
			// Nested foreign trees and flat owned trees stay classified correctly.
			expect(isForeignSkillPath(".claude/skills/code-review/SKILL.md", index)).toBe(true);
			expect(isSkillPath("skeleton/SKILL.md", index)).toBe(true);
			expect(isForeignSkillPath("skeleton/SKILL.md", index)).toBe(false);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
