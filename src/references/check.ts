import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import type { AuditContext } from "../audit/core/context.ts";
import { type Issue, issue } from "../audit/core/report.ts";
import { normalizeRelPath } from "../audit/core/shared.ts";
import {
	CANONICAL_REFS_DIR,
	isGeneratedReference,
	SHARED_REF_LINK_RE,
	stripGeneratedHeader,
} from "./constants.ts";
import { discoverSkillReferencePlans, generatedRefPath } from "./discover.ts";

function listAllGeneratedFiles(root: string): string[] {
	const files: string[] = [];
	const walk = (dir: string): void => {
		if (!existsSync(dir)) return;
		for (const entry of readdirSync(dir, { withFileTypes: true })) {
			if (entry.name.startsWith(".")) continue;
			const fullPath = join(dir, entry.name);
			if (entry.isDirectory()) {
				walk(fullPath);
				continue;
			}
			if (!entry.name.endsWith(".md")) continue;
			const content = readFileSync(fullPath, "utf8");
			if (isGeneratedReference(content)) {
				files.push(normalizeRelPath(relative(root, fullPath)));
			}
		}
	};
	walk(root);
	return files;
}

export function runGeneratedReferencesCheck(root: string): Issue[] {
	const issues: Issue[] = [];
	const canonicalDir = join(root, CANONICAL_REFS_DIR);
	if (!existsSync(canonicalDir)) return issues;

	const plans = discoverSkillReferencePlans(root);
	const needed = new Set<string>();
	for (const plan of plans) {
		for (const refPath of plan.refPaths) {
			needed.add(generatedRefPath(plan.skill, refPath));
		}
	}

	for (const targetRel of needed) {
		const targetPath = join(root, targetRel);
		if (!existsSync(targetPath)) {
			issues.push(
				issue(
					"generated-references",
					targetRel,
					"missing generated copy — run skeleton references sync",
				),
			);
			continue;
		}

		const generated = readFileSync(targetPath, "utf8");
		if (!isGeneratedReference(generated)) {
			issues.push(
				issue(
					"generated-references",
					targetRel,
					"expected generated-reference provenance header",
				),
			);
			continue;
		}

		const body = stripGeneratedHeader(generated);
		const sourceRel = normalizeRelPath(
			generated.match(/source: ([^\n]+)/)?.[1] ??
				join(CANONICAL_REFS_DIR, targetRel.split("/references/")[1] ?? ""),
		);
		const canonicalPath = join(root, sourceRel);
		if (!existsSync(canonicalPath)) {
			issues.push(
				issue(
					"generated-references",
					targetRel,
					`canonical source missing: ${sourceRel}`,
				),
			);
			continue;
		}

		const canonical = readFileSync(canonicalPath, "utf8");
		if (body !== canonical) {
			issues.push(
				issue(
					"generated-references",
					targetRel,
					"stale generated copy — run skeleton references sync",
				),
			);
		}
	}

	for (const generatedRel of listAllGeneratedFiles(root)) {
		if (!needed.has(generatedRel)) {
			issues.push(
				issue(
					"generated-references",
					generatedRel,
					"orphaned generated copy — run skeleton references sync",
				),
			);
		}
	}

	for (const plan of plans) {
		const skillDir = join(root, plan.skill);
		if (!existsSync(skillDir)) continue;
		const walk = (dir: string): void => {
			for (const entry of readdirSync(dir, { withFileTypes: true })) {
				if (entry.name.startsWith(".")) continue;
				const fullPath = join(dir, entry.name);
				if (entry.isDirectory()) {
					walk(fullPath);
					continue;
				}
				if (!entry.name.endsWith(".md")) continue;
				const relFile = normalizeRelPath(relative(root, fullPath));
				const content = readFileSync(fullPath, "utf8");
				if (content.match(SHARED_REF_LINK_RE)) {
					issues.push(
						issue(
							"generated-references",
							relFile,
							"still links to shared root references/ — run skeleton references sync",
						),
					);
				}
			}
		};
		walk(skillDir);
	}

	return issues;
}

export function runGeneratedReferencesRule(ctx: AuditContext): Issue[] {
	return runGeneratedReferencesCheck(ctx.root);
}

export const generatedReferencesRule = {
	id: "generated-references",
	global: true,
	run: runGeneratedReferencesRule,
};
