import { generatedReferencesRule } from "../../references/check.ts";
import type { AuditContext } from "../core/context.ts";
import type { Issue } from "../core/report.ts";
import { bannedRule } from "./banned.ts";
import { coverageGapsRule } from "./coverage-gaps.ts";
import { docMetaRule } from "./doc-meta.ts";
import { linksRule } from "./links.ts";
import { registryRule } from "./registry.ts";
import { scanRootsRule } from "./scan-roots.ts";
import { skillIndexRule } from "./skill-index.ts";

export interface AuditRule {
	id: string;
	global?: boolean;
	run: (ctx: AuditContext) => Issue[];
}

export const docsRules: AuditRule[] = [
	{ ...scanRootsRule, global: true },
	{ ...registryRule, global: true },
	{ ...coverageGapsRule, global: true },
	linksRule,
	docMetaRule,
	{ ...bannedRule, global: true },
];

export const skillsRules: AuditRule[] = [
	{ ...skillIndexRule, global: true },
	{ ...generatedReferencesRule, global: true },
];

export const allRules: AuditRule[] = [...docsRules, ...skillsRules];

export function rulesForSuite(suite: string): AuditRule[] {
	switch (suite) {
		case "docs":
			return docsRules;
		case "skills":
			return skillsRules;
		case "self":
			return allRules;
		default:
			throw new Error(`Unknown suite: ${suite}`);
	}
}

export function globalRulesForSuite(suite: string): AuditRule[] {
	return rulesForSuite(suite).filter((rule) => rule.global);
}

export function pathScopedRulesForSuite(suite: string): AuditRule[] {
	return rulesForSuite(suite).filter((rule) => !rule.global);
}
