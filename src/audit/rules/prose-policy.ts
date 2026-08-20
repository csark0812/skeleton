import { readFileContent, relPath } from "../core/collect.ts";
import type { AuditContext } from "../core/context.ts";
import { isDraftPlacementAllowed } from "../core/draft.ts";
import { type Issue, issue } from "../core/report.ts";
import { policiesForFile } from "../policies/load.ts";

/**
 * Generic prose matcher. Idle when `ctx.policies` is empty.
 * Fingerprint-mode entries are skipped (belong in consumer duplication rules).
 */
interface DraftEntryInput {
	rel: string;
	lines: string[];
	entry: { regex?: RegExp | null; message: string; severity?: Issue["severity"] };
	draftPrefixes: string[];
}

function checkDraftEntry(input: DraftEntryInput): Issue[] {
	const { rel, lines, entry, draftPrefixes } = input;
	const issues: Issue[] = [];
	for (let i = 0; i < lines.length; i++) {
		if (entry.regex?.test(lines[i] ?? "") && !isDraftPlacementAllowed(rel, draftPrefixes)) {
			issues.push(
				issue("prose-policy", rel, {
					message: entry.message,
					link: `line ${i + 1}`,
					severity: entry.severity,
				}),
			);
		}
	}
	return issues;
}

function checkLineEntry(
	rel: string,
	lines: string[],
	entry: { regex?: RegExp | null; message: string; severity?: Issue["severity"] },
): Issue[] {
	const issues: Issue[] = [];
	for (let i = 0; i < lines.length; i++) {
		if (entry.regex?.test(lines[i] ?? "")) {
			issues.push(
				issue("prose-policy", rel, {
					message: entry.message,
					link: `line ${i + 1}`,
					severity: entry.severity,
				}),
			);
		}
	}
	return issues;
}

interface PolicyEntryInput {
	rel: string;
	content: string;
	lines: string[];
	entry: {
		id: string;
		regex?: RegExp | null;
		message: string;
		pattern?: string;
		severity?: Issue["severity"];
		placement?: "any" | "draft-only";
	};
	draftPrefixes: string[];
}

function checkPolicyEntry(input: PolicyEntryInput): Issue[] {
	const { rel, content, lines, entry, draftPrefixes } = input;
	if (entry.placement === "draft-only" || entry.id === "draft-marker") {
		return checkDraftEntry({ rel, lines, entry, draftPrefixes });
	}
	const isMultiline = entry.pattern?.includes("[\\s\\S]");
	if (isMultiline) {
		return entry.regex?.test(content)
			? [issue("prose-policy", rel, { message: entry.message, severity: entry.severity })]
			: [];
	}
	return checkLineEntry(rel, lines, entry);
}

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
			if (entry.mode === "fingerprint" || !entry.regex) continue;
			issues.push(...checkPolicyEntry({ rel, content, lines, entry, draftPrefixes }));
		}
	}

	return issues;
}

export const prosePolicyRule = { id: "prose-policy", run: runProsePolicyRule };
