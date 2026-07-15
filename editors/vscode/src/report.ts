import type { SkeletonIssue, SkeletonReport } from "./types";

function issueKey(issue: SkeletonIssue): string {
	const range = issue.range
		? `${issue.range.start.line}:${issue.range.start.column}-${issue.range.end.line}:${issue.range.end.column}`
		: "";
	return `${issue.rule}\0${issue.file}\0${issue.message}\0${range}`;
}

/** Merge suite reports for workspace / policy proves; drop exact duplicates. */
export function mergeReports(reports: SkeletonReport[], label: string): SkeletonReport {
	const seen = new Set<string>();
	const issues: SkeletonIssue[] = [];
	for (const report of reports) {
		for (const issue of report.issues) {
			const key = issueKey(issue);
			if (seen.has(key)) continue;
			seen.add(key);
			issues.push(issue);
		}
	}
	return {
		label,
		errors: issues.filter((issue) => issue.severity === "error").length,
		warnings: issues.filter((issue) => issue.severity === "warning").length,
		issues,
	};
}
