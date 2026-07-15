import { describe, expect, it } from "bun:test";
import { join } from "node:path";
import type { AuditContext } from "../core/context.ts";
import { parseRegistry } from "../core/registry.ts";
import { runRegistryRule } from "../rules/registry.ts";
import { EMPTY_SKILL_INDEX } from "./empty-skill-index.ts";

const FIXTURES = join(import.meta.dir, "fixtures");
const MALFORMED = join(FIXTURES, "malformed");

describe("parseRegistry", () => {
	it("parses relative and parent paths from registry table", () => {
		const { paths } = parseRegistry(FIXTURES);
		expect(paths).toContain("docs/developer/validation.md");
		expect(paths).toContain("k8s/README.md");
	});

	it("returns empty paths when table rows are malformed", () => {
		const { paths, hasTableHeader } = parseRegistry(MALFORMED);
		expect(hasTableHeader).toBe(true);
		expect(paths).toHaveLength(0);
	});
});

describe("registry rule", () => {
	it("errors when table header exists but 0 rows parsed", () => {
		const ctx = {
			root: MALFORMED,
			config: {
				scan: { include: [], exclude: [], banned: [] },
				daysUntilStale: 180,
			},
			registryPaths: [],
			registryHasTableHeader: true,
			files: [],
			docMetaPaths: [],
			retiredSkills: new Set<string>(),
			skillIndex: EMPTY_SKILL_INDEX,
			lockedSkillSlugs: new Set<string>(),
			policies: [],
		} as AuditContext;
		const issues = runRegistryRule(ctx);
		expect(issues).toHaveLength(1);
		expect(issues[0]?.message).toContain("0 rows parsed");
		expect(issues[0]?.message).not.toContain("≥");
	});

	it("flags missing Source of truth banner on registry entries", () => {
		const noBannerRoot = join(FIXTURES, "no-banner");
		const ctx = {
			root: noBannerRoot,
			config: {
				scan: { include: [], exclude: [], banned: [] },
				daysUntilStale: 180,
			},
			registryPaths: ["docs/no-banner.md"],
			registryHasTableHeader: true,
			files: [],
			docMetaPaths: [],
			retiredSkills: new Set<string>(),
			skillIndex: EMPTY_SKILL_INDEX,
			lockedSkillSlugs: new Set<string>(),
			policies: [],
		} as AuditContext;
		const issues = runRegistryRule(ctx);
		expect(issues.some((i) => i.message.includes("Source of truth for"))).toBe(true);
	});
});
