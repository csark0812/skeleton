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
import { buildSkillIndex } from "../core/skill-roots.ts";
import { runDocMetaRule } from "../rules/doc-meta.ts";
import { runAudit } from "../run.ts";

function writeConsumerFixture(
	root: string,
	opts: {
		foreignSlug?: string;
		ownedSlug?: string;
		ownedSlugs?: string[];
		refRel?: string;
		refDocMeta?: string;
	},
): void {
	const foreignSlug = opts.foreignSlug ?? "toolbox-skill";
	mkdirSync(join(root, ".skeleton"), { recursive: true });
	mkdirSync(join(root, "docs"), { recursive: true });
	mkdirSync(join(root, `.claude/skills/${foreignSlug}/references`), { recursive: true });
	writeFileSync(
		join(root, ".skeleton/config.yaml"),
		`scan:\n  include: ["docs/**"]\n  exclude: [".claude/**"]\ndaysUntilStale: 180\n${
			opts.ownedSlugs ? `skillOwnership:\n  ownedSlugs: [${opts.ownedSlugs.join(", ")}]\n` : ""
		}`,
	);
	writeFileSync(
		join(root, "docs/README.md"),
		"# Docs\n\n<!-- source-of-truth: docs index -->\n\n<!-- doc-meta: owner=eng | last-reviewed=2099-01-01 -->\n",
	);
	writeFileSync(
		join(root, `.claude/skills/${foreignSlug}/SKILL.md`),
		`---\nname: ${foreignSlug}\ndescription: x\n---\n\nBody.\n`,
	);
	const refRel = opts.refRel ?? `.claude/skills/${foreignSlug}/references/foo.md`;
	const refAbs = join(root, refRel);
	mkdirSync(join(refAbs, ".."), { recursive: true });
	const banner = `<!-- source-of-truth: ${foreignSlug} reference -->\n\n`;
	const meta = opts.refDocMeta ?? "";
	writeFileSync(join(refAbs), `${banner}${meta}# Foo\n`);
	writeFileSync(
		join(root, "skills-lock.json"),
		JSON.stringify({
			version: 1,
			skills: {
				[foreignSlug]: { source: "org/toolbox", sourceType: "github" },
				...(opts.ownedSlug ? { [opts.ownedSlug]: { source: "local", sourceType: "local" } } : {}),
			},
		}),
	);
}

describe("foreign skill doc-meta scope", () => {
	it("excludes SSOT-cited foreign skill references from collectDocMetaPaths", () => {
		const root = join(tmpdir(), `skeleton-docmeta-foreign-collect-${Date.now()}`);
		try {
			writeConsumerFixture(root, {});
			const config = loadConfig(root);
			const skillIndex = buildSkillIndex(root, config.skillOwnership);
			const foreignRef = ".claude/skills/toolbox-skill/references/foo.md";
			const paths = collectDocMetaPaths({
				config,
				root,
				registryPaths: [foreignRef, "docs/README.md"],
				skillIndex,
			});
			expect(paths).not.toContain(foreignRef);
			expect(paths).toContain("docs/README.md");
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("passes docs audit when foreign ref has SSOT without doc-meta", async () => {
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
		} finally {
			err.mockRestore();
			log.mockRestore();
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("still audits owned skill refs in doc-meta", () => {
		const root = join(tmpdir(), `skeleton-docmeta-owned-${Date.now()}`);
		try {
			writeConsumerFixture(root, {
				ownedSlug: "local-skill",
				ownedSlugs: ["local-skill"],
				refRel: ".claude/skills/local-skill/references/bar.md",
				refDocMeta: "<!-- doc-meta: owner=eng | last-reviewed=2000-01-01 -->\n",
			});
			mkdirSync(join(root, ".claude/skills/local-skill/references"), { recursive: true });
			writeFileSync(
				join(root, ".claude/skills/local-skill/SKILL.md"),
				"---\nname: local-skill\ndescription: x\n---\n\nBody.\n",
			);
			writeFileSync(
				join(root, ".claude/skills/local-skill/references/bar.md"),
				"<!-- source-of-truth: local skill reference -->\n\n<!-- doc-meta: owner=eng | last-reviewed=2000-01-01 -->\n\n# Bar\n",
			);
			// Include owned skill tree in scan for this case
			writeFileSync(
				join(root, ".skeleton/config.yaml"),
				`scan:\n  include: ["docs/**", ".claude/skills/local-skill/**"]\n  exclude: []\ndaysUntilStale: 180\nskillOwnership:\n  ownedSlugs: [local-skill]\n`,
			);
			writeFileSync(
				join(root, "skills-lock.json"),
				JSON.stringify({
					version: 1,
					skills: {
						"toolbox-skill": { source: "org/toolbox", sourceType: "github" },
						"local-skill": { source: "local", sourceType: "local" },
					},
				}),
			);

			const ctx = createContext({ root });
			const issues = runDocMetaRule(ctx);
			expect(issues.some((i) => i.file === ".claude/skills/local-skill/references/bar.md")).toBe(
				true,
			);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("excludeForeignSkillDocMetaPaths drops foreign trees", () => {
		const root = join(tmpdir(), `skeleton-docmeta-filter-${Date.now()}`);
		try {
			writeConsumerFixture(root, {});
			const config = loadConfig(root);
			const skillIndex = buildSkillIndex(root, config.skillOwnership);
			const filtered = excludeForeignSkillDocMetaPaths(
				["docs/README.md", ".claude/skills/toolbox-skill/references/foo.md"],
				skillIndex,
			);
			expect(filtered).toEqual(["docs/README.md"]);
			expect(
				filterDocMetaPaths(
					["docs/README.md", ".claude/skills/toolbox-skill/references/foo.md"],
					["docs"],
					skillIndex,
				),
			).toEqual(["docs/README.md"]);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});
