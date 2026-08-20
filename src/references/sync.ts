import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { dirname, join, relative } from "node:path";
import process from "node:process";
import { loadConfig } from "../audit/config/load.ts";
import type { SkillOwnershipConfig } from "../audit/config/types.ts";
import { normalizeRelPath } from "../audit/core/shared.ts";
import { CANONICAL_REFS_DIR, formatGeneratedHeader, isGeneratedReference } from "./constants.ts";
import {
	discoverSkillReferencePlans,
	generatedRefPath,
	rewriteSharedRefLinks,
	type SkillReferencePlan,
} from "./discover.ts";

export interface SyncOptions {
	root?: string;
	dryRun?: boolean;
	rewriteLinks?: boolean;
	/** Override config skillOwnership (defaults to loadConfig(root).skillOwnership). */
	ownership?: SkillOwnershipConfig;
}

export interface SyncResult {
	written: string[];
	rewritten: string[];
	removed: string[];
	skipped: string[];
}

function resolveOwnership(
	root: string,
	override?: SkillOwnershipConfig,
): SkillOwnershipConfig | undefined {
	if (override !== undefined) return override;
	try {
		return loadConfig(root).skillOwnership;
	} catch {}
}

function walkMarkdownFiles(dir: string, root: string): string[] {
	const files: string[] = [];
	if (!existsSync(dir)) return files;
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		if (entry.name.startsWith(".")) continue;
		const fullPath = join(dir, entry.name);
		if (entry.isDirectory()) {
			files.push(...walkMarkdownFiles(fullPath, root));
			continue;
		}
		if (entry.name.endsWith(".md")) {
			files.push(normalizeRelPath(relative(root, fullPath)));
		}
	}
	return files;
}

interface GeneratedCollectInput {
	dir: string;
	refsDir: string;
	skillDir: string;
	files: string[];
}

function collectGeneratedInDir(input: GeneratedCollectInput): void {
	const { dir, refsDir, skillDir, files } = input;
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const fullPath = join(dir, entry.name);
		if (entry.isDirectory()) {
			collectGeneratedInDir({ dir: fullPath, refsDir, skillDir, files });
			continue;
		}
		if (!entry.name.endsWith(".md")) continue;
		const content = readFileSync(fullPath, "utf8");
		if (!isGeneratedReference(content)) continue;
		const refPath = normalizeRelPath(relative(refsDir, fullPath));
		files.push(generatedRefPath(skillDir, refPath));
	}
}

function listGeneratedReferenceFiles(root: string, skillDir: string): string[] {
	const refsDir = join(root, skillDir, "references");
	if (!existsSync(refsDir)) return [];
	const files: string[] = [];
	collectGeneratedInDir({ dir: refsDir, refsDir, skillDir, files });
	return files;
}

interface SyncPlanContext {
	root: string;
	plan: SkillReferencePlan;
	options: SyncOptions;
	result: SyncResult;
}

function syncGeneratedCopy(ctx: SyncPlanContext, refPath: string): void {
	const { root, plan, options, result } = ctx;
	const sourceRel = normalizeRelPath(join(CANONICAL_REFS_DIR, refPath));
	const canonicalPath = join(root, sourceRel);
	if (!existsSync(canonicalPath)) {
		throw new Error(`canonical reference missing: ${sourceRel}`);
	}

	const targetRel = generatedRefPath(plan.skillDir, refPath);
	const targetPath = join(root, targetRel);
	const canonicalContent = readFileSync(canonicalPath, "utf8");
	const nextContent = formatGeneratedHeader(sourceRel) + canonicalContent;

	if (!options.dryRun) mkdirSync(dirname(targetPath), { recursive: true });

	const existing = existsSync(targetPath) ? readFileSync(targetPath, "utf8") : null;
	if (existing !== nextContent) {
		if (!options.dryRun) writeFileSync(targetPath, nextContent, "utf8");
		result.written.push(targetRel);
	} else {
		result.skipped.push(targetRel);
	}
}

function rewritePlanLinks(ctx: SyncPlanContext, skillDir: string): void {
	const { root, plan, options, result } = ctx;
	if (options.rewriteLinks === false) return;
	for (const relFile of walkMarkdownFiles(skillDir, root)) {
		const filePath = join(root, relFile);
		const content = readFileSync(filePath, "utf8");
		const next = rewriteSharedRefLinks(content, relFile, plan.skillDir);
		if (next === content) continue;
		if (!options.dryRun) writeFileSync(filePath, next, "utf8");
		result.rewritten.push(relFile);
	}
}

function removeStaleGenerated(ctx: SyncPlanContext): void {
	const { root, plan, options, result } = ctx;
	for (const generatedRel of listGeneratedReferenceFiles(root, plan.skillDir)) {
		const refPath = generatedRel.slice(`${plan.skillDir}/references/`.length);
		if (plan.refPaths.has(refPath)) continue;
		if (!options.dryRun) unlinkSync(join(root, generatedRel));
		result.removed.push(generatedRel);
	}
}

function syncPlan(ctx: SyncPlanContext): void {
	const skillDir = join(ctx.root, ctx.plan.skillDir);
	for (const refPath of ctx.plan.refPaths) {
		syncGeneratedCopy(ctx, refPath);
	}
	rewritePlanLinks(ctx, skillDir);
	removeStaleGenerated(ctx);
}

export function syncReferences(options: SyncOptions = {}): SyncResult {
	const root = options.root ?? process.cwd();
	const canonicalDir = join(root, CANONICAL_REFS_DIR);
	if (!existsSync(canonicalDir)) {
		throw new Error(`canonical references dir not found: ${CANONICAL_REFS_DIR}`);
	}

	const result: SyncResult = { written: [], rewritten: [], removed: [], skipped: [] };
	const plans = discoverSkillReferencePlans(root, resolveOwnership(root, options.ownership));
	for (const plan of plans) syncPlan({ root, plan, options, result });
	return result;
}
