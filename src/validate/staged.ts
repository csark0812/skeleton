import type { SkeletonConfig } from "../audit/config/types.ts";
import { pathDiffersFromHead } from "../audit/core/repo-files.ts";
import { type Issue, issue } from "../audit/core/report.ts";
import { reviewProofPath } from "../audit/core/review-proof.ts";
import { normalizeRelPath } from "../audit/core/shared.ts";

function stageRequiredIssue(file: string): Issue {
	return issue("validate-changed", file, {
		code: "stage-required",
		message:
			"worktree differs from HEAD and is not staged; stage the attested document and its review proof file",
	});
}

export function stageRequiredDiagnostics(input: {
	staged: boolean;
	stagedPaths: string[];
	impactedDocuments: string[];
	config: SkeletonConfig;
	root: string;
}): Issue[] {
	if (!input.staged) return [];
	const staged = new Set(input.stagedPaths.map(normalizeRelPath));
	const required = [
		...input.impactedDocuments,
		...input.impactedDocuments.map((document) => reviewProofPath(input.config, document)),
	];
	const issues: Issue[] = [];
	for (const path of [...new Set(required)].sort()) {
		if (staged.has(path)) continue;
		if (!pathDiffersFromHead(input.root, path)) continue;
		issues.push(stageRequiredIssue(path));
	}
	return issues;
}
