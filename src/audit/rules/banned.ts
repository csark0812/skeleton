import { collectBannedFiles, relPath } from "../core/collect.ts";
import type { AuditContext } from "../core/context.ts";
import { type Issue, issue } from "../core/report.ts";

export function runBannedRule(ctx: AuditContext): Issue[] {
	const issues: Issue[] = [];
	for (const abs of collectBannedFiles(ctx.config, ctx.root)) {
		const rel = relPath(abs, ctx.root);
		issues.push(
			issue("banned", rel, "file matches scan.banned — must not exist in repo"),
		);
	}
	return issues;
}

export const bannedRule = { id: "banned", run: runBannedRule };
