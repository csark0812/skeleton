import { describe, expect, it } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	buildSkillIndex,
	detectSkillRoots,
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
});
