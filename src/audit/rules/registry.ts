import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { relPath } from "../core/collect.ts";
import type { AuditContext } from "../core/context.ts";
import {
	REGISTRY_REL_PATH,
	SOURCE_OF_TRUTH_BANNER_LINE_RE,
	SOURCE_OF_TRUTH_BANNER_RE,
} from "../core/shared.ts";
import { type Issue, issue } from "../core/report.ts";

export function runRegistryRule(ctx: AuditContext): Issue[] {
	const issues: Issue[] = [];
	const registry = new Set(ctx.registryPaths);

	if (ctx.registryHasTableHeader && ctx.registryPaths.length === 0) {
		issues.push(
			issue(
				"registry",
				REGISTRY_REL_PATH,
				"registry table header found but 0 rows parsed — check | Topic | Canonical file | format and link syntax",
			),
		);
	}

	for (const rel of ctx.registryPaths) {
		const abs = join(ctx.root, rel);
		if (!existsSync(abs)) {
			issues.push(issue("registry", rel, "registry entry file missing"));
			continue;
		}
		const content = readFileSync(abs, "utf8");
		if (!SOURCE_OF_TRUTH_BANNER_RE.test(content)) {
			issues.push(
				issue(
					"registry",
					rel,
					"missing **Source of truth for** banner (required for registry entry)",
				),
			);
		}
	}

	for (const filePath of ctx.files) {
		const rel = relPath(filePath, ctx.root);
		if (rel === REGISTRY_REL_PATH) continue;
		if (!rel.endsWith(".md") && !rel.endsWith(".mdc")) continue;
		const content = readFileSync(filePath, "utf8");
		if (!SOURCE_OF_TRUTH_BANNER_LINE_RE.test(content)) continue;
		if (!registry.has(rel)) {
			issues.push(
				issue(
					"registry",
					rel,
					"has **Source of truth for** banner but is not in .skeleton/registry.md — add registry row or remove banner",
				),
			);
		}
	}

	return issues;
}

export const registryRule = { id: "registry", run: runRegistryRule };
