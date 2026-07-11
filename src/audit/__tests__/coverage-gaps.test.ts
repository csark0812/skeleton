import { describe, expect, it } from "bun:test";
import { join } from "node:path";
import { collectCoverageCandidateFiles } from "../core/collect.ts";
import { loadConfig } from "../config/load.ts";
import type { AuditContext } from "../core/context.ts";
import { COVERAGE_BUILTIN_EXCLUDES } from "../config/load.ts";
import { runCoverageGapsRule } from "../rules/coverage-gaps.ts";

const FIXTURES = join(import.meta.dir, "fixtures");

describe("coverageGapsRule", () => {
	it("flags markdown outside scan perimeter in fixture tree", () => {
		const config = loadConfig(FIXTURES);
		const ctx = {
			root: FIXTURES,
			config,
			files: [],
			docMetaPaths: [],
			registryPaths: [],
			registryHasTableHeader: false,
			retiredSkills: new Set<string>(),
		} as AuditContext;
		const exclude = [...COVERAGE_BUILTIN_EXCLUDES, ...config.scan.exclude];
		const issues = runCoverageGapsRule(ctx);
		expect(
			collectCoverageCandidateFiles(FIXTURES, exclude).length,
		).toBeGreaterThan(0);
		expect(issues.some((i) => i.file === "packages/outlier.md")).toBe(true);
		expect(issues.every((i) => i.severity === "warning")).toBe(true);
	});
});
