import { describe, expect, it } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	isAuditablePath,
	isConfigOrRegistry,
	isForeignLockedSkillPath,
	isMarkdownPath,
	isPluginPolicy,
	isSkillTreePath,
	resolveSkeletonRoot,
} from "./paths.ts";

describe("isAuditablePath", () => {
	it("accepts markdown, config, registry, and plugin policy", () => {
		expect(isAuditablePath("docs/readme.md", "/ws/docs/readme.md")).toBe(true);
		expect(isAuditablePath("note.mdc", "/ws/note.mdc")).toBe(true);
		expect(isAuditablePath(".skeleton/config.yaml", "/ws/.skeleton/config.yaml")).toBe(true);
		expect(isAuditablePath(".skeleton/registry.md", "/ws/.skeleton/registry.md")).toBe(true);
		expect(
			isAuditablePath(".skeleton/plugins/foo/policy.yaml", "/ws/.skeleton/plugins/foo/policy.yaml"),
		).toBe(true);
	});

	it("rejects non-auditable open/save noise so generation is not bumped", () => {
		expect(isAuditablePath("package.json", "/ws/package.json")).toBe(false);
		expect(isAuditablePath("src/cli.ts", "/ws/cli.ts")).toBe(false);
		expect(isAuditablePath(".skeleton/hooks.json", "/ws/.skeleton/hooks.json")).toBe(false);
	});
});

describe("isSkillTreePath", () => {
	it("routes nested skill bodies under a slug, not skills-root README", () => {
		expect(isSkillTreePath(".claude/skills/code-review/SKILL.md", "/tmp")).toBe(true);
		expect(isSkillTreePath(".agents/skills/multi/references/a.md", "/tmp")).toBe(true);
		expect(isSkillTreePath(".claude/skills/README.md", "/tmp")).toBe(false);
		expect(isSkillTreePath(".agents/skills/notes.md", "/tmp")).toBe(false);
	});

	it("routes any flat-skill path when SKILL.md exists (CLI isSkillPath parity)", () => {
		const dir = join(tmpdir(), `flat-skill-route-${Date.now()}`);
		mkdirSync(join(dir, "multi"), { recursive: true });
		writeFileSync(join(dir, "multi", "SKILL.md"), "---\nname: multi\n---\n");
		writeFileSync(join(dir, "multi", "customize.md"), "# customize\n");
		try {
			expect(isSkillTreePath("multi/customize.md", dir)).toBe(true);
			expect(isSkillTreePath("multi/references/note.md", dir)).toBe(true);
			expect(isSkillTreePath("multi/SKILL.md", dir)).toBe(true);
			expect(isSkillTreePath("docs/readme.md", dir)).toBe(false);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("does not treat denylisted dirs or their SKILL.md as skill trees", () => {
		const dir = join(tmpdir(), `flat-skill-deny-${Date.now()}`);
		mkdirSync(join(dir, "docs"), { recursive: true });
		writeFileSync(join(dir, "docs", "SKILL.md"), "---\nname: docs\n---\n");
		writeFileSync(join(dir, "docs", "guide.md"), "# guide\n");
		try {
			expect(isSkillTreePath("docs/guide.md", dir)).toBe(false);
			// CLI isSkillPath: docs/**/SKILL.md is non-skill (denylisted root).
			expect(isSkillTreePath("docs/SKILL.md", dir)).toBe(false);
			expect(isSkillTreePath("docs/code-review/SKILL.md", dir)).toBe(false);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});

describe("path helpers", () => {
	it("classifies markdown, config, and plugin policy", () => {
		expect(isMarkdownPath("/a/b.md")).toBe(true);
		expect(isMarkdownPath("/a/b.MDC")).toBe(true);
		expect(isMarkdownPath("/a/b.ts")).toBe(false);
		expect(isConfigOrRegistry(".skeleton/config.yaml")).toBe(true);
		expect(isPluginPolicy(".skeleton/plugins/x/policy.yml")).toBe(true);
		expect(isPluginPolicy(".skeleton/config.yaml")).toBe(false);
	});
});

describe("resolveSkeletonRoot", () => {
	it("returns the start dir when config is present", () => {
		const dir = join(tmpdir(), `skel-root-here-${Date.now()}`);
		mkdirSync(join(dir, ".skeleton"), { recursive: true });
		writeFileSync(join(dir, ".skeleton", "config.yaml"), "scan:\n  include: []\n");
		try {
			expect(resolveSkeletonRoot(dir)).toBe(dir);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("walks up to a parent with .skeleton/config.yaml", () => {
		const root = join(tmpdir(), `skel-root-parent-${Date.now()}`);
		const nested = join(root, "editors", "vscode");
		mkdirSync(join(root, ".skeleton"), { recursive: true });
		mkdirSync(nested, { recursive: true });
		writeFileSync(join(root, ".skeleton", "config.yaml"), "scan:\n  include: []\n");
		try {
			expect(resolveSkeletonRoot(nested)).toBe(root);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("throws when no config exists in the ancestry", () => {
		const dir = join(tmpdir(), `skel-root-missing-${Date.now()}`);
		mkdirSync(dir, { recursive: true });
		try {
			expect(() => resolveSkeletonRoot(dir)).toThrow(/No \.skeleton\/config\.yaml/);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});

describe("isForeignLockedSkillPath", () => {
	it("treats github-locked nested skills as foreign", () => {
		const dir = join(tmpdir(), `skel-foreign-editor-${Date.now()}`);
		mkdirSync(join(dir, ".claude", "skills", "foreign"), { recursive: true });
		writeFileSync(
			join(dir, "skills-lock.json"),
			JSON.stringify({
				version: 1,
				skills: {
					foreign: { source: "org/toolbox", sourceType: "github" },
					mine: { source: "local", sourceType: "local" },
				},
			}),
		);
		try {
			expect(isForeignLockedSkillPath(".claude/skills/foreign/SKILL.md", dir)).toBe(true);
			expect(isForeignLockedSkillPath(".claude/skills/mine/SKILL.md", dir)).toBe(false);
			expect(isForeignLockedSkillPath("docs/readme.md", dir)).toBe(false);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
