import { describe, expect, it } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SkeletonConfig } from "../config/types.ts";
import type { AuditContext } from "../core/context.ts";
import { isDraftPlacementAllowed } from "../core/draft.ts";
import { compilePolicy, loadPolicyFile, policiesForFile } from "../policies/load.ts";
import { runProsePolicyRule } from "../rules/prose-policy.ts";

const emptySkillIndex: AuditContext["skillIndex"] = {
	roots: [],
	slugs: [],
};

function makeCtx(overrides: Partial<AuditContext> & { root: string }): AuditContext {
	const config: SkeletonConfig = {
		scan: { include: ["docs/**"], exclude: [], banned: [] },
		daysUntilStale: 180,
		...(overrides.config ?? {}),
	};
	return {
		config,
		files: [],
		docMetaPaths: [],
		registryPaths: [],
		registryHasTableHeader: true,
		retiredSkills: new Set(),
		skillIndex: emptySkillIndex,
		policies: [],
		...overrides,
	};
}

describe("compilePolicy", () => {
	it("compiles valid pattern entries", () => {
		const policy = compilePolicy("sample", [{ id: "a", pattern: "foo", message: "no foo" }]);
		expect(policy.entries[0]?.regex?.test("FOO")).toBe(true);
	});

	it("rejects invalid regex", () => {
		expect(() => compilePolicy("sample", [{ id: "bad", pattern: "(", message: "x" }])).toThrow(
			/Invalid regex/,
		);
	});

	it("keeps skill-hub-duplication case-sensitive", () => {
		const policy = compilePolicy("skill-hub-duplication", [
			{ id: "a", pattern: "Foo", message: "x" },
		]);
		expect(policy.entries[0]?.regex?.test("Foo")).toBe(true);
		expect(policy.entries[0]?.regex?.test("foo")).toBe(false);
	});

	it("skips fingerprint regex", () => {
		const policy = compilePolicy("sample", [
			{ id: "fp", mode: "fingerprint", message: "x", canonical: "a.md" },
		]);
		expect(policy.entries[0]?.regex).toBeNull();
	});

	it("filters by scope", () => {
		const policy = compilePolicy("sample", [
			{ id: "a", pattern: "x", message: "m", scope: "docs/**" },
		]);
		expect(policiesForFile([policy], "docs/a.md")).toHaveLength(1);
		expect(policiesForFile([policy], "other/a.md")).toHaveLength(0);
	});

	it("rejects bare YAML arrays", () => {
		expect(() => loadPolicyFile("/tmp/x.yaml", "- id: a\n  message: m\n")).toThrow(
			/Policy File shape/,
		);
	});
});

describe("isDraftPlacementAllowed", () => {
	it("allows _draft- filenames", () => {
		expect(isDraftPlacementAllowed("docs/_draft-notes.md", [])).toBe(true);
	});

	it("allows draftPathPrefixes", () => {
		expect(isDraftPlacementAllowed("drafts/wip.md", ["drafts/"])).toBe(true);
	});

	it("rejects elsewhere", () => {
		expect(isDraftPlacementAllowed("docs/readme.md", ["drafts/"])).toBe(false);
	});
});

describe("prose-policy rule", () => {
	it("is idle with empty policies", () => {
		const issues = runProsePolicyRule(
			makeCtx({
				root: "/tmp",
				files: ["/tmp/docs/a.md"],
				policies: [],
			}),
		);
		expect(issues).toEqual([]);
	});

	it("hits line matches and skips fingerprint", () => {
		const policy = compilePolicy("sample", [
			{ id: "banned", pattern: "BADWORD", message: "no BADWORD" },
			{ id: "fp", mode: "fingerprint", message: "fp", canonical: "a.md" },
		]);
		const dir = join(tmpdir(), `prose-${Date.now()}`);
		const file = join(dir, "docs/a.md");
		mkdirSync(join(dir, "docs"), { recursive: true });
		writeFileSync(file, "hello BADWORD there\n");
		try {
			const issues = runProsePolicyRule(
				makeCtx({
					root: dir,
					files: [file],
					policies: [policy],
				}),
			);
			expect(issues).toHaveLength(1);
			expect(issues[0]?.message).toContain("BADWORD");
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("allows draft-marker under prefixes", () => {
		const policy = compilePolicy("deprecated-prose", [
			{
				id: "draft-marker",
				pattern: "^\\s*<!--\\s*status:\\s*draft\\s*-->\\s*$",
				message: "draft only in allow-list",
			},
		]);
		const dir = join(tmpdir(), `draft-${Date.now()}`);
		const allowed = join(dir, "drafts/wip.md");
		const denied = join(dir, "docs/live.md");
		mkdirSync(join(dir, "drafts"), { recursive: true });
		mkdirSync(join(dir, "docs"), { recursive: true });
		writeFileSync(allowed, "<!-- status: draft -->\n");
		writeFileSync(denied, "<!-- status: draft -->\n");
		try {
			const issues = runProsePolicyRule(
				makeCtx({
					root: dir,
					files: [allowed, denied],
					policies: [policy],
					config: {
						scan: { include: ["**"], exclude: [], banned: [] },
						daysUntilStale: 180,
						draftPathPrefixes: ["drafts/"],
					},
				}),
			);
			expect(issues).toHaveLength(1);
			expect(issues[0]?.file).toBe("docs/live.md");
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("matches multiline [\\s\\S] patterns", () => {
		const policy = compilePolicy("sample", [
			{
				id: "multi",
				pattern: "AAA[\\s\\S]{0,20}BBB",
				message: "multiline hit",
			},
		]);
		const dir = join(tmpdir(), `multi-${Date.now()}`);
		const file = join(dir, "docs/a.md");
		mkdirSync(join(dir, "docs"), { recursive: true });
		writeFileSync(file, "AAA\nxx\nBBB\n");
		try {
			const issues = runProsePolicyRule(
				makeCtx({
					root: dir,
					files: [file],
					policies: [policy],
				}),
			);
			expect(issues).toHaveLength(1);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
