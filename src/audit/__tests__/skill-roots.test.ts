import { describe, expect, it } from "bun:test";
import { join } from "node:path";
import {
	buildSkillIndex,
	detectSkillRoots,
	isSkillPath,
	resolveSkillPath,
	slugFromPath,
} from "../core/skill-roots.ts";

const FIXTURES = join(import.meta.dir, "fixtures");

describe("skill-roots", () => {
	it("detects flat root skill layout", () => {
		const toolbox = join(FIXTURES, "toolbox-repo");
		const index = buildSkillIndex(toolbox);
		expect(index.slugs).toContain("multi");
		expect(resolveSkillPath(index, toolbox, "multi")).toBe("multi/SKILL.md");
	});

	it("detects nested .claude/skills layout", () => {
		const postprint = join(FIXTURES, "postprint-repo");
		const index = buildSkillIndex(postprint);
		expect(index.slugs).toContain("code-review");
		expect(resolveSkillPath(index, postprint, "code-review")).toBe(
			".claude/skills/code-review/SKILL.md",
		);
	});

	it("classifies skill paths", () => {
		const postprint = join(FIXTURES, "postprint-repo");
		const index = buildSkillIndex(postprint);
		expect(isSkillPath(".claude/skills/code-review/SKILL.md", index)).toBe(true);
		expect(isSkillPath("docs/foo.md", index)).toBe(false);
	});

	it("extracts slug from SKILL.md path", () => {
		expect(slugFromPath(".claude/skills/testing/SKILL.md")).toBe("testing");
		expect(slugFromPath("multi/SKILL.md")).toBe("multi");
	});

	it("excludes references and _shared under nested roots", () => {
		const postprint = join(FIXTURES, "postprint-repo");
		const roots = detectSkillRoots(postprint);
		const index = buildSkillIndex(postprint);
		expect(index.slugs).not.toContain("references");
		expect(index.slugs).not.toContain("_shared");
		expect(roots.some((r) => r.relPath === ".claude/skills")).toBe(true);
	});
});
