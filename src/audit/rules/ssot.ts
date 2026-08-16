import type { AuditContext } from "../core/context.ts";
import { type Issue, issue } from "../core/report.ts";

export function runSsotRule(ctx: AuditContext): Issue[] {
	const issues: Issue[] = [];
	for (const err of ctx.ssotErrors) {
		issues.push(issue("ssot", err.path, err.detail));
	}
	return issues;
}

export const ssotRule = { id: "ssot", run: runSsotRule };
