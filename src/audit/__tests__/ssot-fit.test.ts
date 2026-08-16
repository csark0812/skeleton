import { describe, expect, it } from "bun:test";
import {
	buildEvidenceText,
	contentTokens,
	evaluateSsotFit,
	evidenceHasPhrase,
	extractH1,
	lightStem,
	longestSummaryPhrase,
	ssotEvidenceOverlap,
} from "../core/ssot-fit.ts";

describe("lightStem", () => {
	it("stems safe plurals without smashing blocklisted words", () => {
		expect(lightStem("tiers")).toBe("tier");
		expect(lightStem("conventions")).toBe("convention");
		expect(lightStem("business")).toBe("business");
		expect(lightStem("analysis")).toBe("analysis");
	});
});

describe("evidence + overlap", () => {
	it("passes tiers SSOT against H1 Tiers + agent body", () => {
		const content = `# Tiers

**Source of truth for** the three-tier agent ecosystem.

<!-- doc-meta: owner=eng | last-reviewed=2099-01-01 -->

Map of the three-tier agent ecosystem across skeleton and toolbox.

| Repo | Role |
|------|------|
| **skeleton** | audit CLI |

Skeleton never calls Nx — consumers call skeleton for SSOT paths.
`;
		const evidence = buildEvidenceText(content);
		expect(extractH1(content)).toBe("Tiers");
		expect(contentTokens("Tiers")).toContain("tier");
		const overlap = ssotEvidenceOverlap("the three-tier agent ecosystem", evidence);
		expect(overlap).toBeGreaterThanOrEqual(0.35);
	});

	it("passes authoring SSOT when H1 carries authoring conventions", () => {
		const content = `# Authoring conventions

**Source of truth for** Skeleton framework authoring conventions.

Every canonical doc carries a source-of-truth marker. Use skeleton catalog.
`;
		const overlap = ssotEvidenceOverlap(
			"Skeleton framework authoring conventions",
			buildEvidenceText(content),
		);
		expect(overlap).toBeGreaterThanOrEqual(0.35);
	});

	it("fails registry SSOT on catalog-only body", () => {
		const content = `# Catalog

**Source of truth for** registry topic routing.

The agent catalog is generated. Run skeleton catalog.
`;
		const overlap = ssotEvidenceOverlap("registry topic routing", buildEvidenceText(content));
		expect(overlap).toBeLessThan(0.35);
	});
});

describe("phrase explanation", () => {
	it("detects missing contiguous phrase", () => {
		const phrase = longestSummaryPhrase("validation routing lanes");
		expect(phrase).toEqual(["validation", "routing", "lane"]);
		if (!phrase) throw new Error("expected phrase");
		expect(evidenceHasPhrase("lanes for routing validation exist", phrase)).toBe(false);
		expect(evidenceHasPhrase("validation routing lanes are documented", phrase)).toBe(true);
	});
});

describe("evaluateSsotFit", () => {
	it("warns short summaries", () => {
		const issues = evaluateSsotFit([
			{ path: "a.md", summary: "TODO", content: "# TODO\n\nBody about TODO stuff.\n" },
		]);
		expect(issues.some((i) => i.kind === "short")).toBe(true);
	});

	it("warns better-match when own is weak and sibling fits", () => {
		const issues = evaluateSsotFit([
			{
				path: "wrong.md",
				summary: "Billing API webhook conventions",
				content: `# Getting started\n\n**Source of truth for** Billing API webhook conventions.\n\nInstall the package and run init.\n`,
			},
			{
				path: "billing.md",
				summary: "Install and init",
				content: `# Billing API\n\n**Source of truth for** Install and init.\n\nThe billing API webhook conventions use https://example.com/hook.\n`,
			},
		]);
		const better = issues.find((i) => i.kind === "better-match" && i.path === "wrong.md");
		expect(better).toBeTruthy();
		expect(better?.otherPath).toBe("billing.md");
		expect(better?.message).toContain("rewrite this SSOT");
		expect(better?.message).toContain("consider combining");
	});

	it("does not better-match when own overlap already healthy", () => {
		const issues = evaluateSsotFit([
			{
				path: "a.md",
				summary: "Agent cold-start validation",
				content: `# Agent cold-start\n\n**Source of truth for** Agent cold-start validation.\n\nAgent cold-start validation lanes are listed here.\n`,
			},
			{
				path: "b.md",
				summary: "Plugin audit rules",
				content: `# Plugins\n\n**Source of truth for** Plugin audit rules.\n\nPlugin audit rules and agent cold-start validation both mention skeleton.\n`,
			},
		]);
		expect(issues.filter((i) => i.kind === "better-match")).toEqual([]);
	});

	it("adds phrase hint only on weak overlap", () => {
		const issues = evaluateSsotFit([
			{
				path: "x.md",
				summary: "precommit hook install flags",
				content: `# CSS tokens\n\n**Source of truth for** precommit hook install flags.\n\nColors and spacing for the design system.\n`,
			},
		]);
		const weak = issues.find((i) => i.kind === "weak");
		expect(weak?.message).toMatch(/key phrase/);
	});
});
