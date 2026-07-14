import { describe, expect, it, spyOn } from "bun:test";
import { mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createContext } from "../core/context.ts";
import {
	applyFixes,
	coalesceFixEdits,
	type FixEdit,
	parseFixKinds,
	resolveWritePath,
} from "../core/fix.ts";
import { collectAnchorFixes, replaceExactLinkTarget } from "../fix/anchors.ts";
import { bumpDocMetaLastReviewed } from "../fix/doc-meta.ts";
import { findBestAnchorMatch } from "../fix/match-anchor.ts";

describe("parseFixKinds", () => {
	it("parses --fix and subsets", () => {
		expect(parseFixKinds(true)).toEqual(["doc-meta", "anchors"]);
		expect(parseFixKinds("doc-meta")).toEqual(["doc-meta"]);
		expect(parseFixKinds("anchors")).toEqual(["anchors"]);
		expect(() => parseFixKinds("nope")).toThrow(/Unknown/);
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
		writeFileSync(join(dir, "docs/target.md"), "# Hello World\n\nBody\n");
		writeFileSync(join(dir, "docs/source.md"), "See [x](./target.md#hello-worl).\n");
		const ctx = {
			root: dir,
			files: [join(dir, "docs/source.md")],
		} as ReturnType<typeof createContext>;
		const edits = collectAnchorFixes(ctx);
		expect(edits[0]?.content).toContain("#hello-world");
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
