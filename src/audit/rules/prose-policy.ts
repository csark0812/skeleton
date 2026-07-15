import { readFileContent, relPath } from "../core/collect.ts";
import type { AuditContext } from "../core/context.ts";
import { isDraftPlacementAllowed } from "../core/draft.ts";
import { type Issue, issue } from "../core/report.ts";
import { rangeFromOffsets, type SourceRange } from "../core/source-range.ts";
import { policiesForFile } from "../policies/load.ts";

function firstMatchRange(content: string, regex: RegExp): SourceRange | undefined {
	regex.lastIndex = 0;
	const match = regex.exec(content);
	regex.lastIndex = 0;
	if (!match) return undefined;
	return rangeFromOffsets(content, match.index, match.index + match[0].length);
}

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
		let lineOffset = 0;
		const policies = policiesForFile(ctx.policies, rel);

		for (const entry of policies) {
			// Fingerprint entries belong in consumer duplication rules, not core matching.
			if (entry.mode === "fingerprint") continue;
			if (!entry.regex) continue;

			if (entry.id === "draft-marker") {
				for (let i = 0; i < lines.length; i++) {
					const line = lines[i] ?? "";
					const range = firstMatchRange(line, entry.regex);
					if (range && !isDraftPlacementAllowed(rel, draftPrefixes)) {
						issues.push(
							issue("prose-policy", rel, entry.message, {
								link: `line ${i + 1}`,
								range: rangeFromOffsets(
									content,
									lineOffset + range.start.column - 1,
									lineOffset + range.end.column - 1,
								),
								severity: entry.severity,
							}),
						);
					}
					lineOffset += line.length + 1;
				}
				lineOffset = 0;
				continue;
			}

			const isMultiline = entry.pattern?.includes("[\\s\\S]");
			if (isMultiline) {
				const range = firstMatchRange(content, entry.regex);
				if (range) {
					issues.push(
						issue("prose-policy", rel, entry.message, {
							range,
							severity: entry.severity,
						}),
					);
				}
				continue;
			}

			for (let i = 0; i < lines.length; i++) {
				const line = lines[i] ?? "";
				const range = firstMatchRange(line, entry.regex);
				if (range) {
					issues.push(
						issue("prose-policy", rel, entry.message, {
							link: `line ${i + 1}`,
							range: rangeFromOffsets(
								content,
								lineOffset + range.start.column - 1,
								lineOffset + range.end.column - 1,
							),
							severity: entry.severity,
						}),
					);
				}
				lineOffset += line.length + 1;
			}
			lineOffset = 0;
		}
	}

	return issues;
}

export const prosePolicyRule = { id: "prose-policy", run: runProsePolicyRule };
