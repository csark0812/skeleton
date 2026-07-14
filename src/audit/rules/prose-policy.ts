import { readFileContent, relPath } from "../core/collect.ts";
import type { AuditContext } from "../core/context.ts";
import { isDraftPlacementAllowed } from "../core/draft.ts";
import { type Issue, issue } from "../core/report.ts";
import { policiesForFile } from "../policies/load.ts";

/**
 * Generic prose matcher. Idle when `ctx.policies` is empty.
 * Fingerprint-mode entries are skipped (belong in consumer duplication rules).
 */
export function runProsePolicyRule(ctx: AuditContext): Issue[] {
	if (ctx.policies.length === 0) return [];

	const issues: Issue[] = [];
	const draftPrefixes = ctx.config.draftPathPrefixes ?? [];

	for (const filePath of ctx.files) {
		const rel = relPath(filePath, ctx.root);
		const content = readFileContent(filePath);
		const lines = content.split("\n");
		const policies = policiesForFile(ctx.policies, rel);

		for (const entry of policies) {
			// PostPrint cold-start fingerprints live in a separate duplication rule.
			if (entry.policyName === "cold-start-duplication") continue;
			if (entry.mode === "fingerprint") continue;
			if (!entry.regex) continue;

			if (entry.id === "draft-marker") {
				for (let i = 0; i < lines.length; i++) {
					if (entry.regex.test(lines[i] ?? "") && !isDraftPlacementAllowed(rel, draftPrefixes)) {
						issues.push(
							issue("prose-policy", rel, entry.message, {
								link: `line ${i + 1}`,
								severity: entry.severity,
							}),
						);
					}
				}
				continue;
			}

			const isMultiline = entry.pattern?.includes("[\\s\\S]");
			if (isMultiline) {
				if (entry.regex.test(content)) {
					issues.push(issue("prose-policy", rel, entry.message, { severity: entry.severity }));
				}
				continue;
			}

			for (let i = 0; i < lines.length; i++) {
				if (entry.regex.test(lines[i] ?? "")) {
					issues.push(
						issue("prose-policy", rel, entry.message, {
							link: `line ${i + 1}`,
							severity: entry.severity,
						}),
					);
				}
			}
		}
	}

	return issues;
}

export const prosePolicyRule = { id: "prose-policy", run: runProsePolicyRule };
