import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import type { SkillOwnershipConfig } from "../audit/config/types.ts";
import type { AuditContext } from "../audit/core/context.ts";
import { type Issue, issue } from "../audit/core/report.ts";
import { normalizeRelPath } from "../audit/core/shared.ts";
import { buildSkillIndex, isForeignSkillPath } from "../audit/core/skill-roots.ts";
import {
	CANONICAL_REFS_DIR,
	isGeneratedReference,
	SHARED_REF_LINK_RE,
	stripGeneratedHeader,
} from "./constants.ts";
import { discoverSkillReferencePlans, generatedRefPath } from "./discover.ts";

function walkMarkdown(dir: string, onFile: (fullPath: string) => void): void {
	if (!existsSync(dir)) return;
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		if (entry.name.startsWith(".")) continue;
		const fullPath = join(dir, entry.name);
		if (entry.isDirectory()) {
			walkMarkdown(fullPath, onFile);
			continue;
		}
		if (!entry.name.endsWith(".md")) continue;
		onFile(fullPath);
	}
}

function listAllGeneratedFiles(root: string): string[] {
	const files: string[] = [];
	walkMarkdown(root, (fullPath) => {
		const content = readFileSync(fullPath, "utf8");
		if (isGeneratedReference(content)) {
			files.push(normalizeRelPath(relative(root, fullPath)));
		}
	});
	return files;
}

function checkNeededCopy(root: string, targetRel: string): Issue | null {
	const targetPath = join(root, targetRel);
	if (!existsSync(targetPath)) {
		return issue(
			"generated-references",
			targetRel,
			"missing generated copy — run skeleton references sync",
		);
	}

	const generated = readFileSync(targetPath, "utf8");
	if (!isGeneratedReference(generated)) {
		return issue(
			"generated-references",
			targetRel,
			"expected generated-reference provenance header",
		);
	}

	const body = stripGeneratedHeader(generated);
	const sourceRel = normalizeRelPath(
		generated.match(/source: ([^\n]+)/)?.[1] ??
			join(CANONICAL_REFS_DIR, targetRel.split("/references/")[1] ?? ""),
	);
	const canonicalPath = join(root, sourceRel);
	if (!existsSync(canonicalPath)) {
		return issue("generated-references", targetRel, `canonical source missing: ${sourceRel}`);
	}

	const canonical = readFileSync(canonicalPath, "utf8");
	if (body !== canonical) {
		return issue(
			"generated-references",
			targetRel,
			"stale generated copy — run skeleton references sync",
		);
	}
	return null;
}

function checkOrphanedCopies(
	root: string,
	needed: Set<string>,
	skillIndex: ReturnType<typeof buildSkillIndex>,
): Issue[] {
	const issues: Issue[] = [];
	for (const generatedRel of listAllGeneratedFiles(root)) {
		if (isForeignSkillPath(generatedRel, skillIndex)) continue;
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
	return issues;
}

function checkStaleSharedLinks(root: string, skillDir: string): Issue[] {
	const issues: Issue[] = [];
	walkMarkdown(skillDir, (fullPath) => {
		const relFile = normalizeRelPath(relative(root, fullPath));
		const content = readFileSync(fullPath, "utf8");
		if (!content.match(SHARED_REF_LINK_RE)) return;
		issues.push(
			issue(
				"generated-references",
				relFile,
				"still links to shared root references/ — run skeleton references sync",
			),
		);
	});
	return issues;
}

export function runGeneratedReferencesCheck(
	root: string,
	ownership?: SkillOwnershipConfig,
): Issue[] {
	const issues: Issue[] = [];
	const canonicalDir = join(root, CANONICAL_REFS_DIR);
	if (!existsSync(canonicalDir)) return issues;

	const skillIndex = buildSkillIndex(root, ownership);
	const plans = discoverSkillReferencePlans(root, ownership);
	const needed = new Set<string>();
	for (const plan of plans) {
		for (const refPath of plan.refPaths) {
			needed.add(generatedRefPath(plan.skill, refPath));
		}
	}

	for (const targetRel of needed) {
		const found = checkNeededCopy(root, targetRel);
		if (found) issues.push(found);
	}

	issues.push(...checkOrphanedCopies(root, needed, skillIndex));

	for (const plan of plans) {
		issues.push(...checkStaleSharedLinks(root, join(root, plan.skill)));
	}

	return issues;
}

export function runGeneratedReferencesRule(ctx: AuditContext): Issue[] {
	return runGeneratedReferencesCheck(ctx.root, ctx.config.skillOwnership);
}

export const generatedReferencesRule = {
	id: "generated-references",
	global: true,
	run: runGeneratedReferencesRule,
};
