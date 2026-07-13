import { describe, expect, it } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadConfig } from "../config/load.ts";
import { collectBannedFiles } from "../core/collect.ts";
import { runBannedRule } from "../rules/banned.ts";
import type { AuditContext } from "../core/context.ts";

describe("banned rule", () => {
	it("flags files matching scan.banned globs repo-wide", () => {
		const root = mkdtempSync(join(tmpdir(), "skeleton-banned-"));
		mkdirSync(join(root, ".skeleton"), { recursive: true });
		mkdirSync(join(root, "apps", "web"), { recursive: true });
		mkdirSync(join(root, "docs"), { recursive: true });
		writeFileSync(
			join(root, ".skeleton", "config.yaml"),
			`scan:
  include: ["docs/**"]
  exclude: []
  banned: ["apps/**/*_ANALYSIS.md"]
daysUntilStale: 180
`,
		);
		writeFileSync(join(root, "apps", "web", "foo_ANALYSIS.md"), "# artifact\n");
		writeFileSync(join(root, "docs", "ok.md"), "# ok\n");

		const config = loadConfig(root);
		const found = collectBannedFiles(config, root);
		expect(found.some((f) => f.endsWith("foo_ANALYSIS.md"))).toBe(true);

		const ctx = {
			root,
			config,
			files: [],
			docMetaPaths: [],
			registryPaths: [],
			registryHasTableHeader: false,
			retiredSkills: new Set<string>(),
			skillIndex: { roots: [], slugs: [] },
		} as AuditContext;
		const issues = runBannedRule(ctx);
		expect(
			issues.some(
				(i) => i.rule === "banned" && i.file.includes("foo_ANALYSIS.md"),
			),
		).toBe(true);
	});
});
