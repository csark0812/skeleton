import { describe, expect, it, spyOn } from "bun:test";
import { mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createContext } from "../core/context.ts";
import {
	applyFixes,
	coalesceFixEdits,
	type FixEdit,
	fixKindsForOnly,
	parseFixKinds,
	resolveWritePath,
} from "../core/fix.ts";
import { collectAnchorFixes, replaceExactLinkTarget } from "../fix/anchors.ts";
import { bumpDocMetaLastReviewed } from "../fix/doc-meta.ts";
import { findBestAnchorMatch } from "../fix/match-anchor.ts";
import { parseAuditArgs } from "../run.ts";

describe("parseFixKinds", () => {
	it("parses --fix and subsets", () => {
		expect(parseFixKinds(true)).toEqual(["doc-meta", "anchors"]);
		expect(parseFixKinds("doc-meta")).toEqual(["doc-meta"]);
		expect(parseFixKinds("anchors")).toEqual(["anchors"]);
		expect(() => parseFixKinds("nope")).toThrow(/Unknown/);
	});
});

describe("parseAuditArgs --fix", () => {
	it("accepts --fix=kind and space-separated kind", () => {
		expect(parseAuditArgs(["--fix"]).fix).toBe(true);
		expect(parseAuditArgs(["--fix=doc-meta"]).fix).toBe("doc-meta");
		expect(parseAuditArgs(["--fix", "doc-meta"]).fix).toBe("doc-meta");
		expect(parseAuditArgs(["--fix", "anchors", "--dry-run"]).fix).toBe("anchors");
		expect(parseAuditArgs(["--fix", "anchors", "--dry-run"]).dryRun).toBe(true);
	});

	it("rejects unknown space-separated --fix kinds", () => {
		expect(() => parseAuditArgs(["--fix", "nope"])).toThrow(/Unknown --fix kind/);
	});

	it("rejects --dry-run=<value> forms", () => {
		expect(() => parseAuditArgs(["--fix", "anchors", "--dry-run=true"])).toThrow(
			/--dry-run \(boolean flag\)/,
		);
	});
});

describe("fixKindsForOnly", () => {
	it("keeps all kinds when --only is unset", () => {
		expect(fixKindsForOnly(["doc-meta", "anchors"], null)).toEqual(["doc-meta", "anchors"]);
	});

	it("maps --only=links to anchors only", () => {
		expect(fixKindsForOnly(["doc-meta", "anchors"], new Set(["links"]))).toEqual(["anchors"]);
	});

	it("returns empty when --only has no fix-owning rules", () => {
		expect(fixKindsForOnly(["doc-meta", "anchors"], new Set(["banned"]))).toEqual([]);
	});
});

describe("bumpDocMetaLastReviewed", () => {
	it("bumps when git date is newer", () => {
		const content = "<!-- doc-meta: owner=eng | last-reviewed=2020-01-01 -->\n";
		const updated = bumpDocMetaLastReviewed(content, "2024-06-01");
		expect(updated).toContain("last-reviewed=2024-06-01");
	});

	it("returns null when already current", () => {
		const content = "<!-- doc-meta: owner=eng | last-reviewed=2024-06-01 -->\n";
		expect(bumpDocMetaLastReviewed(content, "2024-06-01")).toBeNull();
	});

	it("does not rewrite prose last-reviewed before the doc-meta comment", () => {
		const content =
			"Write last-reviewed=2020-01-01 in prose.\n\n<!-- doc-meta: owner=eng | last-reviewed=2020-01-01 -->\n";
		const updated = bumpDocMetaLastReviewed(content, "2024-06-01");
		expect(updated).toContain("Write last-reviewed=2020-01-01 in prose.");
		expect(updated).toContain("<!-- doc-meta: owner=eng | last-reviewed=2024-06-01 -->");
	});
});

describe("findBestAnchorMatch", () => {
	it("matches close slugs", () => {
		const match = findBestAnchorMatch("getting-started", ["getting-started-guide", "other"]);
		expect(match?.slug).toBe("getting-started-guide");
	});

	it("returns null when ambiguous", () => {
		const match = findBestAnchorMatch("ab", ["abc", "abd"]);
		expect(match).toBeNull();
	});

	it("does not rewrite broken fragments onto shorter heading prefixes", () => {
		expect(findBestAnchorMatch("getting-started", ["getting"])).toBeNull();
		expect(findBestAnchorMatch("getting-started", ["get"])).toBeNull();
	});

	it("does not score raw string prefixes as perfect matches", () => {
		expect(findBestAnchorMatch("cli", ["client"])?.score ?? 0).toBeLessThan(1);
		expect(findBestAnchorMatch("get", ["getting-started"])).toBeNull();
	});

	it("still scores hyphen-bounded extensions as perfect", () => {
		expect(findBestAnchorMatch("getting-started", ["getting-started-guide"])?.score).toBe(1);
	});

	it("does not rewrite single-token or low-overlap fragments via coverage", () => {
		expect(findBestAnchorMatch("start", ["quick-start"])).toBeNull();
		expect(findBestAnchorMatch("guide", ["user-guide"])).toBeNull();
		expect(findBestAnchorMatch("authentication-flow", ["authorization-flow"])).toBeNull();
	});
});

describe("coalesceFixEdits", () => {
	it("overlays last-reviewed onto anchor content for the same file", () => {
		const meta: FixEdit = {
			file: "docs/source.md",
			description: "last-reviewed 2020-01-01 → 2024-06-01",
			content:
				"# Source\n\n<!-- doc-meta: owner=eng | last-reviewed=2024-06-01 -->\n\nSee [t](./t.md#a).\n",
		};
		const anchors: FixEdit = {
			file: "docs/source.md",
			description: "docs/source.md:5 #a → #alpha",
			content:
				"# Source\n\n<!-- doc-meta: owner=eng | last-reviewed=2020-01-01 -->\n\nSee [t](./t.md#alpha).\n",
		};
		const merged = coalesceFixEdits([meta], [anchors]);
		expect(merged).toHaveLength(1);
		expect(merged[0]?.content).toContain("last-reviewed=2024-06-01");
		expect(merged[0]?.content).toContain("#alpha");
		expect(merged[0]?.description).toContain("last-reviewed");
		expect(merged[0]?.description).toContain("#alpha");
	});

	it("prefers doc-meta date over prose last-reviewed when coalescing", () => {
		const meta: FixEdit = {
			file: "docs/source.md",
			description: "last-reviewed 2024-06-01 → 2026-07-13",
			content:
				"Write last-reviewed=2099-01-01 in prose.\n\n<!-- doc-meta: owner=eng | last-reviewed=2026-07-13 -->\n",
		};
		const anchors: FixEdit = {
			file: "docs/source.md",
			description: "docs/source.md:4 #a → #alpha",
			content:
				"Write last-reviewed=2099-01-01 in prose.\n\n<!-- doc-meta: owner=eng | last-reviewed=2024-06-01 -->\n\nSee [t](./t.md#alpha).\n",
		};
		const merged = coalesceFixEdits([meta], [anchors]);
		expect(merged).toHaveLength(1);
		expect(merged[0]?.content).toContain("Write last-reviewed=2099-01-01 in prose.");
		expect(merged[0]?.content).toContain("<!-- doc-meta: owner=eng | last-reviewed=2026-07-13 -->");
		expect(merged[0]?.content).not.toContain(
			"<!-- doc-meta: owner=eng | last-reviewed=2099-01-01 -->",
		);
		expect(merged[0]?.content).toContain("#alpha");
	});
});

describe("replaceExactLinkTarget", () => {
	it("does not clobber longer fragment sharing a prefix", () => {
		const content = "See [a](./t.md#getting-started) and [b](./t.md#getting-started-guide).";
		const next = replaceExactLinkTarget(
			content,
			"./t.md#getting-started",
			"./t.md#getting-started-guide",
		);
		expect(next).toContain("[a](./t.md#getting-started-guide)");
		expect(next).toContain("[b](./t.md#getting-started-guide)");
		expect(next).not.toContain("getting-started-guide-guide");
	});

	it("does not rewrite path-suffix targets with a hyphen prefix", () => {
		const content = "[a](target.md#getting-started) and [b](other-target.md#getting-started)";
		const next = replaceExactLinkTarget(
			content,
			"target.md#getting-started",
			"target.md#getting-started-guide",
		);
		expect(next).toContain("[a](target.md#getting-started-guide)");
		expect(next).toContain("[b](other-target.md#getting-started)");
		expect(next).not.toContain("other-target.md#getting-started-guide");
	});

	it("does not rewrite path-suffix targets under a directory", () => {
		const content = "[a](target.md#getting-started) and [b](foo/target.md#getting-started)";
		const next = replaceExactLinkTarget(
			content,
			"target.md#getting-started",
			"target.md#getting-started-guide",
		);
		expect(next).toContain("[a](target.md#getting-started-guide)");
		expect(next).toContain("[b](foo/target.md#getting-started)");
		expect(next).not.toContain("foo/target.md#getting-started-guide");
	});
});

describe("resolveWritePath", () => {
	it("refuses paths outside the repo root", () => {
		expect(() => resolveWritePath("/tmp/repo", "../outside.md")).toThrow(
			/Refusing autofix outside repo root/,
		);
	});

	it("allows paths under the root", () => {
		expect(resolveWritePath("/tmp/repo", "docs/a.md")).toBe(resolve("/tmp/repo", "docs/a.md"));
	});

	it("refuses symlink write-through outside the repo", () => {
		const dir = join(tmpdir(), `fix-symlink-${Date.now()}`);
		const outside = join(tmpdir(), `fix-outside-${Date.now()}.md`);
		mkdirSync(join(dir, "docs"), { recursive: true });
		writeFileSync(outside, "outside original\n");
		symlinkSync(outside, join(dir, "docs/source.md"));
		try {
			expect(() => resolveWritePath(dir, "docs/source.md")).toThrow(
				/Refusing autofix outside repo root/,
			);
			expect(readFileSync(outside, "utf8")).toBe("outside original\n");
		} finally {
			rmSync(dir, { recursive: true, force: true });
			rmSync(outside, { force: true });
		}
	});

	it("refuses nested missing dirs under a symlink escape", () => {
		const dir = join(tmpdir(), `fix-nested-symlink-${Date.now()}`);
		const outside = join(tmpdir(), `fix-outside-dir-${Date.now()}`);
		mkdirSync(join(dir, "docs"), { recursive: true });
		mkdirSync(outside, { recursive: true });
		symlinkSync(outside, join(dir, "docs/link"));
		try {
			expect(() => resolveWritePath(dir, "docs/link/newdir/x.md")).toThrow(
				/Refusing autofix outside repo root/,
			);
		} finally {
			rmSync(dir, { recursive: true, force: true });
			rmSync(outside, { recursive: true, force: true });
		}
	});
});

describe("applyFixes dry-run", () => {
	it("does not write on dry-run for anchors", () => {
		const dir = join(tmpdir(), `fix-${Date.now()}`);
		mkdirSync(join(dir, ".skeleton"), { recursive: true });
		mkdirSync(join(dir, "docs"), { recursive: true });
		writeFileSync(
			join(dir, ".skeleton/config.yaml"),
			`scan:\n  include: ["docs/**"]\n  exclude: []\n  banned: []\ndaysUntilStale: 180\n`,
		);
		writeFileSync(
			join(dir, ".skeleton/registry.md"),
			`# Registry\n\n<!-- doc-meta: owner=eng | last-reviewed=2026-01-01 -->\n\n**Source of truth for** fix fixture.\n\n## Documentation\n\n| Topic | Canonical file |\n|-------|----------------|\n| Target | [../docs/target.md](../docs/target.md) |\n`,
		);
		writeFileSync(
			join(dir, "docs/target.md"),
			`# Target\n\n<!-- doc-meta: owner=eng | last-reviewed=2099-01-01 -->\n\n**Source of truth for** target.\n\n## Getting Started Guide\n\nHi.\n`,
		);
		writeFileSync(
			join(dir, "docs/source.md"),
			`# Source\n\n<!-- doc-meta: owner=eng | last-reviewed=2099-01-01 -->\n\n**Source of truth for** source.\n\nSee [target](./target.md#getting-started).\n`,
		);

		try {
			const ctx = createContext({ root: dir });
			const before = readFileSync(join(dir, "docs/source.md"), "utf8");
			const result = applyFixes(ctx, { kinds: ["anchors"], dryRun: true });
			expect(result.edits.length).toBeGreaterThan(0);
			expect(readFileSync(join(dir, "docs/source.md"), "utf8")).toBe(before);

			const applied = applyFixes(ctx, { kinds: ["anchors"], dryRun: false });
			expect(applied.modifiedFiles).toContain("docs/source.md");
			expect(readFileSync(join(dir, "docs/source.md"), "utf8")).toContain("#getting-started-guide");
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("does not clobber longer fragments when fixing a short anchor", () => {
		const dir = join(tmpdir(), `fix-prefix-${Date.now()}`);
		mkdirSync(join(dir, ".skeleton"), { recursive: true });
		mkdirSync(join(dir, "docs"), { recursive: true });
		writeFileSync(
			join(dir, ".skeleton/config.yaml"),
			`scan:\n  include: ["docs/**"]\n  exclude: []\n  banned: []\ndaysUntilStale: 180\n`,
		);
		writeFileSync(
			join(dir, ".skeleton/registry.md"),
			`# Registry\n\n<!-- doc-meta: owner=eng | last-reviewed=2099-01-01 -->\n\n**Source of truth for** prefix fixture.\n\n## Documentation\n\n| Topic | Canonical file |\n|-------|----------------|\n| Source | [../docs/source.md](../docs/source.md) |\n| Target | [../docs/target.md](../docs/target.md) |\n`,
		);
		writeFileSync(
			join(dir, "docs/target.md"),
			`# Target\n\n<!-- doc-meta: owner=eng | last-reviewed=2099-01-01 -->\n\n**Source of truth for** target.\n\n## Getting Started Guide\n\nHi.\n`,
		);
		writeFileSync(
			join(dir, "docs/source.md"),
			`# Source\n\n<!-- doc-meta: owner=eng | last-reviewed=2099-01-01 -->\n\n**Source of truth for** source.\n\nSee [target](./target.md#getting-started) and [ok](./target.md#getting-started-guide).\n`,
		);

		try {
			const ctx = createContext({ root: dir });
			applyFixes(ctx, { kinds: ["anchors"], dryRun: false });
			const content = readFileSync(join(dir, "docs/source.md"), "utf8");
			expect(content).toContain("[target](./target.md#getting-started-guide)");
			expect(content).toContain("[ok](./target.md#getting-started-guide)");
			expect(content).not.toContain("getting-started-guide-guide");
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("writes coalesced meta+anchor content for the same file", () => {
		const dir = join(tmpdir(), `fix-coalesce-write-${Date.now()}`);
		mkdirSync(join(dir, "docs"), { recursive: true });
		const abs = join(dir, "docs/source.md");
		writeFileSync(abs, "original\n");
		const merged = coalesceFixEdits(
			[
				{
					file: "docs/source.md",
					description: "last-reviewed 2020-01-01 → 2024-06-01",
					content: "<!-- doc-meta: owner=eng | last-reviewed=2024-06-01 -->\nSee [t](./t.md#a).\n",
				},
			],
			[
				{
					file: "docs/source.md",
					description: "#a → #alpha",
					content:
						"<!-- doc-meta: owner=eng | last-reviewed=2020-01-01 -->\nSee [t](./t.md#alpha).\n",
				},
			],
		);
		expect(merged).toHaveLength(1);
		const edit = merged[0];
		if (!edit) throw new Error("expected coalesced edit");
		writeFileSync(resolveWritePath(dir, edit.file), edit.content);
		const content = readFileSync(abs, "utf8");
		expect(content).toContain("last-reviewed=2024-06-01");
		expect(content).toContain("#alpha");
		rmSync(dir, { recursive: true, force: true });
	});

	it("collectAnchorFixes finds match", () => {
		const dir = join(tmpdir(), `fix2-${Date.now()}`);
		mkdirSync(join(dir, "docs"), { recursive: true });
		writeFileSync(join(dir, "docs/target.md"), "# Hello World Guide\n\nBody\n");
		writeFileSync(join(dir, "docs/source.md"), "See [x](./target.md#hello-world).\n");
		const ctx = {
			root: dir,
			files: [join(dir, "docs/source.md")],
		} as ReturnType<typeof createContext>;
		const edits = collectAnchorFixes(ctx);
		expect(edits[0]?.content).toContain("#hello-world-guide");
		rmSync(dir, { recursive: true, force: true });
	});

	it("collectAnchorFixes rewrites a shared reference definition only once", () => {
		const dir = join(tmpdir(), `fix-ref-multi-${Date.now()}`);
		mkdirSync(join(dir, "docs"), { recursive: true });
		writeFileSync(join(dir, "docs/t.md"), "## Getting Started Guide\n");
		writeFileSync(
			join(dir, "docs/source.md"),
			"See [a][x] and [b][x].\n\n[x]: ./t.md#getting-started\n",
		);
		const ctx = {
			root: dir,
			files: [join(dir, "docs/source.md")],
		} as ReturnType<typeof createContext>;
		const edits = collectAnchorFixes(ctx);
		expect(edits).toHaveLength(1);
		expect(edits[0]?.content).toContain("[x]: ./t.md#getting-started-guide\n");
		expect(edits[0]?.content).not.toContain("getting-started-guide-guide");
		rmSync(dir, { recursive: true, force: true });
	});

	it("collectAnchorFixes rewrites reference destination, not a duplicated title URL", () => {
		const dir = join(tmpdir(), `fix-ref-title-${Date.now()}`);
		mkdirSync(join(dir, "docs"), { recursive: true });
		writeFileSync(join(dir, "docs/guide.md"), "## Setup Guide\n");
		writeFileSync(
			join(dir, "docs/source.md"),
			'[link][ref]\n\n[ref]: ./guide.md#setup "See ./guide.md#setup"\n',
		);
		const ctx = {
			root: dir,
			files: [join(dir, "docs/source.md")],
		} as ReturnType<typeof createContext>;
		const edits = collectAnchorFixes(ctx);
		expect(edits).toHaveLength(1);
		expect(edits[0]?.content).toContain('[ref]: ./guide.md#setup-guide "See ./guide.md#setup"');
		expect(edits[0]?.content).not.toContain('"See ./guide.md#setup-guide"');
		rmSync(dir, { recursive: true, force: true });
	});

	it("collectAnchorFixes rewrites titled inline destination, not a <url> copy in title/label", () => {
		const dir = join(tmpdir(), `fix-inline-title-${Date.now()}`);
		mkdirSync(join(dir, "docs"), { recursive: true });
		writeFileSync(join(dir, "docs/t.md"), "## Getting Started Guide\n");
		writeFileSync(
			join(dir, "docs/source.md"),
			'[Getting started](./t.md#getting-started "See <./t.md#getting-started>")\n',
		);
		const ctx = {
			root: dir,
			files: [join(dir, "docs/source.md")],
		} as ReturnType<typeof createContext>;
		const edits = collectAnchorFixes(ctx);
		expect(edits).toHaveLength(1);
		expect(edits[0]?.content).toContain(
			'[Getting started](./t.md#getting-started-guide "See <./t.md#getting-started>")',
		);
		expect(edits[0]?.content).not.toContain('"See <./t.md#getting-started-guide>"');
		rmSync(dir, { recursive: true, force: true });
	});

	it("collectAnchorFixes rewrites destination when title embeds ](same-url)", () => {
		const dir = join(tmpdir(), `fix-title-paren-${Date.now()}`);
		mkdirSync(join(dir, "docs"), { recursive: true });
		writeFileSync(join(dir, "docs/t.md"), "## Getting Started Guide\n");
		writeFileSync(
			join(dir, "docs/source.md"),
			'[text](./t.md#getting-started "Title with ](./t.md#getting-started) inside")\n',
		);
		const ctx = {
			root: dir,
			files: [join(dir, "docs/source.md")],
		} as ReturnType<typeof createContext>;
		const edits = collectAnchorFixes(ctx);
		expect(edits).toHaveLength(1);
		expect(edits[0]?.content).toContain(
			'[text](./t.md#getting-started-guide "Title with ](./t.md#getting-started) inside")',
		);
		expect(edits[0]?.content).not.toContain('"Title with ](./t.md#getting-started-guide) inside"');
		rmSync(dir, { recursive: true, force: true });
	});

	it("collectAnchorFixes rewrites titled inline destination when label embeds <url>", () => {
		const dir = join(tmpdir(), `fix-inline-label-${Date.now()}`);
		mkdirSync(join(dir, "docs"), { recursive: true });
		writeFileSync(join(dir, "docs/t.md"), "## Getting Started Guide\n");
		writeFileSync(
			join(dir, "docs/source.md"),
			'[see <./t.md#getting-started>](./t.md#getting-started "title")\n',
		);
		const ctx = {
			root: dir,
			files: [join(dir, "docs/source.md")],
		} as ReturnType<typeof createContext>;
		const edits = collectAnchorFixes(ctx);
		expect(edits).toHaveLength(1);
		expect(edits[0]?.content).toContain(
			'[see <./t.md#getting-started>](./t.md#getting-started-guide "title")',
		);
		expect(edits[0]?.content).not.toContain("[see <./t.md#getting-started-guide>]");
		rmSync(dir, { recursive: true, force: true });
	});

	it("collectAnchorFixes rewrites link href when linked image src equals href", () => {
		const dir = join(tmpdir(), `fix-linked-image-${Date.now()}`);
		mkdirSync(join(dir, "docs"), { recursive: true });
		writeFileSync(join(dir, "docs/t.md"), "## Getting Started Guide\n");
		writeFileSync(
			join(dir, "docs/source.md"),
			"[![thumb](./t.md#getting-started)](./t.md#getting-started)\n",
		);
		const ctx = {
			root: dir,
			files: [join(dir, "docs/source.md")],
		} as ReturnType<typeof createContext>;
		const edits = collectAnchorFixes(ctx);
		expect(edits).toHaveLength(1);
		expect(edits[0]?.content).toBe(
			"[![thumb](./t.md#getting-started)](./t.md#getting-started-guide)\n",
		);
		rmSync(dir, { recursive: true, force: true });
	});

	it("collectAnchorFixes rewrites link href when linked image src differs", () => {
		const dir = join(tmpdir(), `fix-linked-image-diff-${Date.now()}`);
		mkdirSync(join(dir, "docs"), { recursive: true });
		writeFileSync(join(dir, "docs/t.md"), "## Getting Started Guide\n");
		writeFileSync(join(dir, "docs/thumb.md"), "# Thumb\n");
		writeFileSync(join(dir, "docs/source.md"), "[![thumb](./thumb.md)](./t.md#getting-started)\n");
		const ctx = {
			root: dir,
			files: [join(dir, "docs/source.md")],
		} as ReturnType<typeof createContext>;
		const edits = collectAnchorFixes(ctx);
		expect(edits).toHaveLength(1);
		expect(edits[0]?.content).toBe("[![thumb](./thumb.md)](./t.md#getting-started-guide)\n");
		rmSync(dir, { recursive: true, force: true });
	});

	it("collectAnchorFixes does not rewrite valid links to emphasized heading slugs", () => {
		const dir = join(tmpdir(), `fix-em-heading-${Date.now()}`);
		mkdirSync(join(dir, "docs"), { recursive: true });
		writeFileSync(join(dir, "docs/target.md"), "## Getting **Started** Guide\n");
		writeFileSync(join(dir, "docs/source.md"), "See [x](./target.md#getting-started-guide).\n");
		const ctx = {
			root: dir,
			files: [join(dir, "docs/source.md")],
		} as ReturnType<typeof createContext>;
		const edits = collectAnchorFixes(ctx);
		expect(edits).toHaveLength(0);
		rmSync(dir, { recursive: true, force: true });
	});

	it("collectAnchorFixes does not rewrite the same target in fences or inline code", () => {
		const dir = join(tmpdir(), `fix-fence-${Date.now()}`);
		mkdirSync(join(dir, "docs"), { recursive: true });
		writeFileSync(join(dir, "docs/target.md"), "# Hello World Guide\n\nBody\n");
		writeFileSync(
			join(dir, "docs/source.md"),
			[
				"See [x](./target.md#hello-world).",
				"",
				"Example: `./target.md#hello-world`",
				"",
				"```",
				"./target.md#hello-world",
				"```",
				"",
			].join("\n"),
		);
		const ctx = {
			root: dir,
			files: [join(dir, "docs/source.md")],
		} as ReturnType<typeof createContext>;
		const edits = collectAnchorFixes(ctx);
		expect(edits).toHaveLength(1);
		const next = edits[0]?.content ?? "";
		expect(next).toContain("[x](./target.md#hello-world-guide)");
		expect(next).toContain("`./target.md#hello-world`");
		expect(next).toContain("```\n./target.md#hello-world\n```");
		expect(next.match(/\.\/target\.md#hello-world(?!-guide)/g)?.length).toBe(2);
		rmSync(dir, { recursive: true, force: true });
	});

	it("collectAnchorFixes does not use .mdc fence headings as targets or rewrite fence links", () => {
		const dir = join(tmpdir(), `fix-mdc-${Date.now()}`);
		mkdirSync(join(dir, "rules"), { recursive: true });
		writeFileSync(
			join(dir, "rules/target.mdc"),
			["# Main", "", "```md", "## Getting Started Guide", "```", ""].join("\n"),
		);
		writeFileSync(
			join(dir, "rules/source.mdc"),
			[
				"See [guide](./target.mdc#getting-started).",
				"",
				"```",
				"[example](./target.mdc#getting-started)",
				"```",
				"",
			].join("\n"),
		);
		const ctx = {
			root: dir,
			files: [join(dir, "rules/source.mdc")],
		} as ReturnType<typeof createContext>;
		const edits = collectAnchorFixes(ctx);
		expect(edits).toHaveLength(0);
		rmSync(dir, { recursive: true, force: true });
	});

	it("collectAnchorFixes does not rewrite onto YAML frontmatter setext false slugs", () => {
		const dir = join(tmpdir(), `fix-frontmatter-${Date.now()}`);
		mkdirSync(join(dir, "docs"), { recursive: true });
		writeFileSync(
			join(dir, "docs/t.md"),
			["---", "title: Getting Started", "---", "", "## Installation", ""].join("\n"),
		);
		writeFileSync(join(dir, "docs/source.md"), "See [x](./t.md#getting-started).\n");
		const ctx = {
			root: dir,
			files: [join(dir, "docs/source.md")],
		} as ReturnType<typeof createContext>;
		const edits = collectAnchorFixes(ctx);
		expect(edits).toHaveLength(0);
		rmSync(dir, { recursive: true, force: true });
	});

	it("collectAnchorFixes does not rewrite onto .mdc frontmatter setext false slugs", () => {
		const dir = join(tmpdir(), `fix-mdc-frontmatter-${Date.now()}`);
		mkdirSync(join(dir, "rules"), { recursive: true });
		writeFileSync(
			join(dir, "rules/t.mdc"),
			[
				"---",
				"description: Getting Started",
				"globs:",
				"alwaysApply: false",
				"---",
				"",
				"# Installation",
				"",
			].join("\n"),
		);
		writeFileSync(join(dir, "rules/source.mdc"), "See [x](./t.mdc#getting-started).\n");
		const ctx = {
			root: dir,
			files: [join(dir, "rules/source.mdc")],
		} as ReturnType<typeof createContext>;
		const edits = collectAnchorFixes(ctx);
		expect(edits).toHaveLength(0);
		rmSync(dir, { recursive: true, force: true });
	});

	it("collectAnchorFixes rewrites the live reference def, not a fenced example copy", () => {
		const dir = join(tmpdir(), `fix-ref-fence-${Date.now()}`);
		mkdirSync(join(dir, "docs"), { recursive: true });
		writeFileSync(join(dir, "docs/t.md"), "## Getting Started Guide\n");
		writeFileSync(
			join(dir, "docs/source.md"),
			[
				"```",
				"[ref]: ./t.md#getting-started",
				"```",
				"",
				"See [a][ref].",
				"",
				"[ref]: ./t.md#getting-started",
				"",
			].join("\n"),
		);
		const ctx = {
			root: dir,
			files: [join(dir, "docs/source.md")],
		} as ReturnType<typeof createContext>;
		const edits = collectAnchorFixes(ctx);
		expect(edits).toHaveLength(1);
		const next = edits[0]?.content ?? "";
		expect(next).toContain("```\n[ref]: ./t.md#getting-started\n```");
		expect(next).toContain("[ref]: ./t.md#getting-started-guide\n");
		expect(next.match(/\[ref\]: \.\/t\.md#getting-started(?!-guide)/g)?.length).toBe(1);
		rmSync(dir, { recursive: true, force: true });
	});

	it("collectAnchorFixes rewrites the live reference def, not an indented-code copy", () => {
		const dir = join(tmpdir(), `fix-ref-indent-${Date.now()}`);
		mkdirSync(join(dir, "docs"), { recursive: true });
		writeFileSync(join(dir, "docs/t.md"), "## Getting Started Guide\n");
		writeFileSync(
			join(dir, "docs/source.md"),
			[
				"    [ref]: ./t.md#getting-started",
				"",
				"See [a][ref].",
				"",
				"[ref]: ./t.md#getting-started",
				"",
			].join("\n"),
		);
		const ctx = {
			root: dir,
			files: [join(dir, "docs/source.md")],
		} as ReturnType<typeof createContext>;
		const edits = collectAnchorFixes(ctx);
		expect(edits).toHaveLength(1);
		const next = edits[0]?.content ?? "";
		expect(next).toContain("    [ref]: ./t.md#getting-started\n");
		expect(next).toContain("[ref]: ./t.md#getting-started-guide\n");
		rmSync(dir, { recursive: true, force: true });
	});

	it("logs autofix progress to stderr, not stdout", () => {
		const dir = join(tmpdir(), `fix-stderr-${Date.now()}`);
		mkdirSync(join(dir, ".skeleton"), { recursive: true });
		mkdirSync(join(dir, "docs"), { recursive: true });
		writeFileSync(
			join(dir, ".skeleton/config.yaml"),
			`scan:\n  include: ["docs/**"]\n  exclude: []\n  banned: []\ndaysUntilStale: 180\n`,
		);
		writeFileSync(
			join(dir, ".skeleton/registry.md"),
			`# Registry\n\n<!-- doc-meta: owner=eng | last-reviewed=2099-01-01 -->\n\n**Source of truth for** stderr fixture.\n\n## Documentation\n\n| Topic | Canonical file |\n|-------|----------------|\n| Target | [../docs/target.md](../docs/target.md) |\n`,
		);
		writeFileSync(
			join(dir, "docs/target.md"),
			`# Target\n\n<!-- doc-meta: owner=eng | last-reviewed=2099-01-01 -->\n\n**Source of truth for** target.\n\n## Getting Started Guide\n\nHi.\n`,
		);
		writeFileSync(
			join(dir, "docs/source.md"),
			`# Source\n\n<!-- doc-meta: owner=eng | last-reviewed=2099-01-01 -->\n\n**Source of truth for** source.\n\nSee [target](./target.md#getting-started).\n`,
		);

		const logSpy = spyOn(console, "log").mockImplementation(() => {});
		const errSpy = spyOn(console, "error").mockImplementation(() => {});
		try {
			const ctx = createContext({ root: dir });
			applyFixes(ctx, { kinds: ["anchors"], dryRun: true });
			expect(logSpy).not.toHaveBeenCalled();
			expect(errSpy.mock.calls.some((c) => String(c[0]).includes("Doc audit autofix"))).toBe(true);
		} finally {
			logSpy.mockRestore();
			errSpy.mockRestore();
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
