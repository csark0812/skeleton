import { validateScanRoots } from "../core/collect.ts";
import type { AuditContext } from "../core/context.ts";
import { type Issue, issue } from "../core/report.ts";

export function runScanRootsRule(ctx: AuditContext): Issue[] {
	const missing = validateScanRoots(ctx.config, ctx.root);
	return missing.map((root) =>
		issue("scan-roots", root, "scan root missing on disk"),
	);
}

export const scanRootsRule = { id: "scan-roots", run: runScanRootsRule };
