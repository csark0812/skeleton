import { describe, expect, it } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	isAuditablePath,
	isConfigOrRegistry,
	isMarkdownPath,
	isPluginPolicy,
	isSkillTreePath,
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
		expect(isAuditablePath("src/cli.ts", "/ws/src/cli.ts")).toBe(false);
		expect(isAuditablePath(".skeleton/hooks.json", "/ws/.skeleton/hooks.json")).toBe(false);
	});
});

describe("isSkillTreePath", () => {
	it("routes nested skill trees and SKILL.md files", () => {
		expect(isSkillTreePath(".claude/skills/code-review/SKILL.md", "/tmp")).toBe(true);
		expect(isSkillTreePath(".agents/skills/multi/references/a.md", "/tmp")).toBe(true);
		expect(isSkillTreePath("multi/SKILL.md", "/tmp")).toBe(true);
	});

	it("routes any flat-skill path when SKILL.md exists (CLI isSkillPath parity)", () => {
		const dir = join(tmpdir(), `flat-skill-route-${Date.now()}`);
		mkdirSync(join(dir, "multi"), { recursive: true });
		writeFileSync(join(dir, "multi", "SKILL.md"), "---\nname: multi\n---\n");
		writeFileSync(join(dir, "multi", "customize.md"), "# customize\n");
		try {
			expect(isSkillTreePath("multi/customize.md", dir)).toBe(true);
			expect(isSkillTreePath("multi/references/note.md", dir)).toBe(true);
			expect(isSkillTreePath("docs/readme.md", dir)).toBe(false);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("does not treat denylisted dirs as flat skill roots", () => {
		const dir = join(tmpdir(), `flat-skill-deny-${Date.now()}`);
		mkdirSync(join(dir, "docs"), { recursive: true });
		writeFileSync(join(dir, "docs", "SKILL.md"), "---\nname: docs\n---\n");
		writeFileSync(join(dir, "docs", "guide.md"), "# guide\n");
		try {
			// SKILL.md itself still matches endsWith; other docs paths must not.
			expect(isSkillTreePath("docs/guide.md", dir)).toBe(false);
			expect(isSkillTreePath("docs/SKILL.md", dir)).toBe(true);
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
