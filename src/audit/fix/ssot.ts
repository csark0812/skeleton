import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { AuditContext } from "../core/context.ts";
import type { FixEdit } from "../core/fix.ts";
import { rewriteLegacySsotToComment } from "../core/ssot.ts";

export function collectSsotFixes(ctx: AuditContext): FixEdit[] {
	const edits: FixEdit[] = [];
	for (const entry of ctx.ssotEntries) {
		if (entry.form !== "legacy") continue;
		const abs = join(ctx.root, entry.path);
		const content = readFileSync(abs, "utf8");
		const next = rewriteLegacySsotToComment(content);
		if (!next) continue;
		edits.push({
			file: entry.path,
			description: "rewrite legacy **Source of truth for** banner to <!-- source-of-truth: … -->",
			content: next,
		});
	}
	return edits;
}
