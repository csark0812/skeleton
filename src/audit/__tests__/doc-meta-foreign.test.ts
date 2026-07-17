import { describe, expect, it, spyOn } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../config/load.ts";
import {
	collectDocMetaPaths,
	excludeForeignSkillDocMetaPaths,
	filterDocMetaPaths,
} from "../core/collect.ts";
import { createContext } from "../core/context.ts";
import { parseRegistry } from "../core/registry.ts";
import { runDocMetaRule } from "../rules/doc-meta.ts";
import { runAudit } from "../run.ts";
import { buildSkillIndex } from "../core/skill-roots.ts";

function writeConsumerFixture(
	root: string,
	opts: {
		foreignSlug?: string;
		ownedSlug?: string;
		ownedSlugs?: string[];
		registryRef?: string;
		refContent?: string;
		refDocMeta?: string;
	},
): void {
	const foreignSlug = opts.foreignSlug ?? "toolbox-skill";
	mkdirSync(join(root, ".skeleton"), { recursive: true });
	mkdirSync(join(root, "docs"), { recursive: true });
	mkdirSync(join(root, `.claude/skills/${foreignSlug}/references`), { recursive: true });
	writeFileSync(
		join(root, ".skeleton/config.yaml"),
		`scan:\n  include: ["docs/**"]\n  exclude: [".claude/**"]\n  banned: []\ndaysUntilStale: 180\n${
			opts.ownedSlugs
				? `skillOwnership:\n  ownedSlugs: [${opts.ownedSlugs.join(", ")}]\n`
				: ""
		}`,
	);
	writeFileSync(
		join(root, "docs/README.md"),
		"# Docs\n\n**Source of truth for** docs index.\n\n<!-- doc-meta: owner=eng | last-reviewed=2099-01-01 -->\n",
	);
	writeFileSync(
		join(root, `.claude/skills/${foreignSlug}/SKILL.md`),
		`---\nname: ${foreignSlug}\ndescription: x\n---\n\nBody.\n`,
	);
	const refRel = opts.registryRef ?? `.claude/skills/${foreignSlug}/references/foo.md`;
	const refAbs = join(root, refRel);
	mkdirSync(join(refAbs, ".."), { recursive: true });
	const banner = `**Source of truth for** ${foreignSlug} reference.\n\n`;
	const meta = opts.refDocMeta ?? "";
	writeFileSync(join(refAbs), `${banner}${meta}# Foo\n`);
	writeFileSync(
		join(root, "skills-lock.json"),
		JSON.stringify({
			version: 1,
			skills: {
				[foreignSlug]: { source: "org/toolbox", sourceType: "github" },
				...(opts.ownedSlug
					? { [opts.ownedSlug]: { source: "local", sourceType: "local" } }
					: {}),
			},
		}),
	);
	const registryLink = refRel.startsWith(".")
		? `[${foreignSlug} ref](../${refRel})`
		: `[${foreignSlug} ref](../${refRel})`;
	writeFileSync(
		join(root, ".skeleton/registry.md"),
		`# Registry\n\n**Source of truth for** fixture registry.\n\n<!-- doc-meta: owner=eng | last-reviewed=2099-01-01 -->\n\n## Documentation\n\n| Topic | Canonical file |\n|-------|----------------|\n| Ref | ${registryLink} |\n`,
	);
}

describe("foreign skill doc-meta scope", () => {
	it("excludes registry-cited foreign skill references from collectDocMetaPaths", () => {
		const root = join(tmpdir(), `skeleton-docmeta-foreign-collect-${Date.now()}`);
		try {
			writeConsumerFixture(root, {});
			const config = loadConfig(root);
			const skillIndex = buildSkillIndex(root, config.skillOwnership);
			const registry = parseRegistry(root);
			const paths = collectDocMetaPaths(config, root, registry.paths, skillIndex);
			expect(paths).not.toContain(".claude/skills/toolbox-skill/references/foo.md");
			expect(paths).toContain(".skeleton/registry.md");
			expect(paths).toContain("docs/README.md");
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("passes docs audit when registry lists foreign ref without doc-meta", async () => {
		const root = join(tmpdir(), `skeleton-docmeta-foreign-audit-${Date.now()}`);
		const err = spyOn(console, "error").mockImplementation(() => {});
		const log = spyOn(console, "log").mockImplementation(() => {});
		try {
			writeConsumerFixture(root, {});
			const exit = await runAudit({
				suite: "docs",
				strict: false,
				json: false,
				paths: [],
				only: new Set(["doc-meta"]),
				root,
			});
			expect(exit).toBe(0);
			const msg = [...err.mock.calls, ...log.mock.calls].flat().join("\n");
			expect(msg).not.toMatch(/missing doc-meta/);
		} finally {
			err.mockRestore();
			log.mockRestore();
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("fails missing doc-meta when the same registry ref is owned via ownedSlugs", async () => {
		const root = join(tmpdir(), `skeleton-docmeta-owned-override-${Date.now()}`);
		const err = spyOn(console, "error").mockImplementation(() => {});
		const log = spyOn(console, "log").mockImplementation(() => {});
		try {
			writeConsumerFixture(root, { ownedSlugs: ["toolbox-skill"] });
			const exit = await runAudit({
				suite: "docs",
				strict: false,
				json: false,
				paths: [],
				only: new Set(["doc-meta"]),
				root,
			});
			expect(exit).toBe(1);
			const msg = [...err.mock.calls, ...log.mock.calls].flat().join("\n");
			expect(msg).toMatch(/missing doc-meta/);
		} finally {
			err.mockRestore();
			log.mockRestore();
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("does not warn on git-date freshness for foreign skill refs that carry doc-meta", () => {
		const root = join(tmpdir(), `skeleton-docmeta-foreign-git-${Date.now()}`);
		try {
			writeConsumerFixture(root, {
				refDocMeta: "<!-- doc-meta: owner=eng | last-reviewed=2020-01-01 -->\n\n",
			});
			const ctx = createContext({ root });
			expect(ctx.docMetaPaths).not.toContain(".claude/skills/toolbox-skill/references/foo.md");
			const issues = runDocMetaRule(ctx);
			expect(
				issues.filter((i) => i.file === ".claude/skills/toolbox-skill/references/foo.md"),
			).toHaveLength(0);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("still requires doc-meta on non-skill registry docs", async () => {
		const root = join(tmpdir(), `skeleton-docmeta-owned-doc-${Date.now()}`);
		const err = spyOn(console, "error").mockImplementation(() => {});
		const log = spyOn(console, "log").mockImplementation(() => {});
		try {
			mkdirSync(join(root, ".skeleton"), { recursive: true });
			mkdirSync(join(root, "docs"), { recursive: true });
			writeFileSync(
				join(root, ".skeleton/config.yaml"),
				`scan:\n  include: ["docs/**"]\n  exclude: []\n  banned: []\ndaysUntilStale: 180\n`,
			);
			writeFileSync(
				join(root, "docs/missing-meta.md"),
				"# Missing\n\n**Source of truth for** missing meta doc.\n",
			);
			writeFileSync(
				join(root, ".skeleton/registry.md"),
				`# Registry\n\n**Source of truth for** fixture registry.\n\n<!-- doc-meta: owner=eng | last-reviewed=2099-01-01 -->\n\n## Documentation\n\n| Topic | Canonical file |\n|-------|----------------|\n| Missing | [missing](../docs/missing-meta.md) |\n`,
			);
			const exit = await runAudit({
				suite: "docs",
				strict: false,
				json: false,
				paths: [],
				only: new Set(["doc-meta"]),
				root,
			});
			expect(exit).toBe(1);
			const msg = [...err.mock.calls, ...log.mock.calls].flat().join("\n");
			expect(msg).toMatch(/missing doc-meta/);
		} finally {
			err.mockRestore();
			log.mockRestore();
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("filterDocMetaPaths drops foreign skill paths even when explicitly requested", () => {
		const root = join(tmpdir(), `skeleton-docmeta-filter-${Date.now()}`);
		try {
			writeConsumerFixture(root, {});
			const config = loadConfig(root);
			const skillIndex = buildSkillIndex(root, config.skillOwnership);
			const all = [
				"docs/README.md",
				".claude/skills/toolbox-skill/references/foo.md",
				".skeleton/registry.md",
			];
			expect(
				filterDocMetaPaths(all, [".claude/skills/toolbox-skill/references/foo.md"], skillIndex),
			).toEqual([]);
			expect(excludeForeignSkillDocMetaPaths(all, skillIndex)).toEqual([
				"docs/README.md",
				".skeleton/registry.md",
			]);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});
