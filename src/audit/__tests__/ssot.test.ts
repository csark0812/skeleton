import { describe, expect, it } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createContext } from "../core/context.ts";
import { parseSsot } from "../core/ssot.ts";
import { runSsotRule } from "../rules/ssot.ts";

describe("parseSsot", () => {
	it("parses comment form", () => {
		const r = parseSsot("<!-- source-of-truth: Config keys -->\n\n# Hi\n");
		expect(r.status).toBe("ok");
		if (r.status === "ok") {
			expect(r.entry.form).toBe("comment");
			expect(r.entry.summary).toBe("Config keys");
		}
	});

	it("parses visible and legacy forms", () => {
		expect(parseSsot("source-of-truth: Visible topic\n").status).toBe("ok");
		expect(parseSsot("**Source of truth for** Legacy topic.\n").status).toBe("ok");
	});

	it("flags dual forms", () => {
		const r = parseSsot("<!-- source-of-truth: A -->\n\nsource-of-truth: B\n");
		expect(r.status).toBe("dual");
	});

	it("ignores SSOT examples inside fenced code", () => {
		const r = parseSsot(
			"**Source of truth for** Real topic.\n\n```markdown\n**Source of truth for** Example only.\n```\n",
		);
		expect(r.status).toBe("ok");
		if (r.status === "ok") expect(r.entry.summary).toBe("Real topic");
	});
});

describe("ssot rule", () => {
	it("errors on dual SSOT encodings", () => {
		const dir = join(tmpdir(), `skel-ssot-dual-${Date.now()}`);
		mkdirSync(join(dir, "docs"), { recursive: true });
		writeFileSync(
			join(dir, "skeleton.toml"),
			`daysUntilStale = 365

[scan]
include = ["docs/**"]
exclude = []
`,
		);
		writeFileSync(
			join(dir, "docs/a.md"),
			"<!-- source-of-truth: A -->\n\nsource-of-truth: B\n\nbody\n",
		);
		try {
			const ctx = createContext({ root: dir });
			const issues = runSsotRule(ctx);
			expect(issues.some((i) => i.rule === "ssot" && i.file === "docs/a.md")).toBe(true);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("allows files without SSOT (opt-in)", () => {
		const dir = join(tmpdir(), `skel-ssot-optin-${Date.now()}`);
		mkdirSync(join(dir, "docs"), { recursive: true });
		writeFileSync(
			join(dir, "skeleton.toml"),
			`daysUntilStale = 365

[scan]
include = ["docs/**"]
exclude = []
`,
		);
		writeFileSync(join(dir, "docs/note.md"), "# Just a note\n");
		try {
			const ctx = createContext({ root: dir });
			expect(ctx.ssotEntries).toEqual([]);
			expect(runSsotRule(ctx)).toEqual([]);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
