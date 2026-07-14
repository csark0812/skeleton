import { generatedReferencesRule } from "../../references/check.ts";
import type { AuditContext } from "../core/context.ts";
import type { Issue } from "../core/report.ts";
import { bannedRule } from "./banned.ts";
import { docMetaRule } from "./doc-meta.ts";
import { linksRule } from "./links.ts";
import { prosePolicyRule } from "./prose-policy.ts";
import { registryRule } from "./registry.ts";
import { coverageGapsRule } from "./scan-gaps.ts";
import { scanRootsRule } from "./scan-roots.ts";
import { skillIndexRule } from "./skill-index.ts";

export type AuditSuite = "docs" | "skills";

export interface AuditRule {
	id: string;
	global?: boolean;
	/** Which audit suites include this rule. Default: `["docs"]`. */
	suites?: AuditSuite[];
	run: (ctx: AuditContext) => Issue[];
}

export const docsRules: AuditRule[] = [
	{ ...scanRootsRule, global: true },
	{ ...registryRule, global: true },
	{ ...coverageGapsRule, global: true },
	linksRule,
	docMetaRule,
	{ ...bannedRule, global: true },
	prosePolicyRule,
];

export const skillsRules: AuditRule[] = [
	{ ...skillIndexRule, global: true },
	{ ...generatedReferencesRule, global: true },
	// Path-scoped: skill bodies are in the docs scan set; ship lanes use audit skills.
	prosePolicyRule,
];

export const allRules: AuditRule[] = [...docsRules, ...skillsRules];

/**
 * Merge core + plugin rules. Fails on duplicate rule ids across core and plugins.
 * Plugin `suites` (default `["docs"]`) controls docs/skills membership; `self` is the union.
 */
export function assembleRules(pluginRules: AuditRule[] = []): {
	docs: AuditRule[];
	skills: AuditRule[];
	self: AuditRule[];
} {
	const coreIds = new Set(allRules.map((rule) => rule.id));
	const seenPlugin = new Set<string>();
	for (const rule of pluginRules) {
		if (seenPlugin.has(rule.id) || coreIds.has(rule.id)) {
			throw new Error(`Duplicate audit rule id: ${rule.id}`);
		}
		seenPlugin.add(rule.id);
	}

	const docs = [...docsRules];
	const skills = [...skillsRules];
	for (const rule of pluginRules) {
		const suites = rule.suites ?? ["docs"];
		const inDocs = suites.includes("docs");
		const inSkills = suites.includes("skills");
		if (!inDocs && !inSkills) {
			const listed = suites.length === 0 ? "(empty)" : suites.join(", ");
			throw new Error(
				`Plugin rule "${rule.id}" suites attach to no known suite (got ${listed}; allowed: docs, skills). ` +
					`"self" is the union of docs+skills — put the rule in docs and/or skills.`,
			);
		}
		if (inDocs) docs.push(rule);
		if (inSkills) skills.push(rule);
	}

	const selfById = new Map<string, AuditRule>();
	for (const rule of [...docs, ...skills]) {
		selfById.set(rule.id, rule);
	}

	return { docs, skills, self: [...selfById.values()] };
}

export function rulesForSuite(suite: string, pluginRules: AuditRule[] = []): AuditRule[] {
	const assembled = assembleRules(pluginRules);
	switch (suite) {
		case "docs":
			return assembled.docs;
		case "skills":
			return assembled.skills;
		case "self":
			return assembled.self;
		default:
			throw new Error(`Unknown suite: ${suite}`);
	}
}

export function globalRulesForSuite(suite: string, pluginRules: AuditRule[] = []): AuditRule[] {
	return rulesForSuite(suite, pluginRules).filter((rule) => rule.global);
}

export function pathScopedRulesForSuite(suite: string, pluginRules: AuditRule[] = []): AuditRule[] {
	return rulesForSuite(suite, pluginRules).filter((rule) => !rule.global);
}
