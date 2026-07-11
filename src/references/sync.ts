import {
	existsSync,
	mkdirSync,
	readFileSync,
	readdirSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { dirname, join, relative } from "node:path";
import { normalizeRelPath } from "../audit/core/shared.ts";
import {
	CANONICAL_REFS_DIR,
	formatGeneratedHeader,
	isGeneratedReference,
} from "./constants.ts";
import {
	discoverSkillReferencePlans,
	generatedRefPath,
	rewriteSharedRefLinks,
} from "./discover.ts";

export interface SyncOptions {
	root?: string;
	dryRun?: boolean;
	rewriteLinks?: boolean;
}

export interface SyncResult {
	written: string[];
	rewritten: string[];
	removed: string[];
	skipped: string[];
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

function listGeneratedReferenceFiles(
	skillDir: string,
	skill: string,
): string[] {
	const refsDir = join(skillDir, "references");
	if (!existsSync(refsDir)) return [];

	const files: string[] = [];
	const walk = (dir: string): void => {
		for (const entry of readdirSync(dir, { withFileTypes: true })) {
			const fullPath = join(dir, entry.name);
			if (entry.isDirectory()) {
				walk(fullPath);
				continue;
			}
			if (!entry.name.endsWith(".md")) continue;
			const content = readFileSync(fullPath, "utf8");
			if (isGeneratedReference(content)) {
				const refPath = normalizeRelPath(relative(refsDir, fullPath));
				files.push(generatedRefPath(skill, refPath));
			}
		}
	};
	walk(refsDir);
	return files;
}

export function syncReferences(options: SyncOptions = {}): SyncResult {
	const root = options.root ?? process.cwd();
	const canonicalDir = join(root, CANONICAL_REFS_DIR);
	if (!existsSync(canonicalDir)) {
		throw new Error(
			`canonical references dir not found: ${CANONICAL_REFS_DIR}`,
		);
	}

	const result: SyncResult = {
		written: [],
		rewritten: [],
		removed: [],
		skipped: [],
	};
	const plans = discoverSkillReferencePlans(root);

	for (const plan of plans) {
		const skillDir = join(root, plan.skill);

		for (const refPath of plan.refPaths) {
			const sourceRel = normalizeRelPath(join(CANONICAL_REFS_DIR, refPath));
			const canonicalPath = join(root, sourceRel);
			if (!existsSync(canonicalPath)) {
				throw new Error(`canonical reference missing: ${sourceRel}`);
			}

			const targetRel = generatedRefPath(plan.skill, refPath);
			const targetPath = join(root, targetRel);
			const canonicalContent = readFileSync(canonicalPath, "utf8");
			const nextContent = formatGeneratedHeader(sourceRel) + canonicalContent;

			if (!options.dryRun) {
				mkdirSync(dirname(targetPath), { recursive: true });
			}

			const existing = existsSync(targetPath)
				? readFileSync(targetPath, "utf8")
				: null;
			if (existing !== nextContent) {
				if (!options.dryRun) writeFileSync(targetPath, nextContent, "utf8");
				result.written.push(targetRel);
			} else {
				result.skipped.push(targetRel);
			}
		}

		if (options.rewriteLinks !== false) {
			for (const relFile of walkMarkdownFiles(skillDir, root)) {
				const filePath = join(root, relFile);
				const content = readFileSync(filePath, "utf8");
				const next = rewriteSharedRefLinks(content, relFile, plan.skill);
				if (next !== content) {
					if (!options.dryRun) writeFileSync(filePath, next, "utf8");
					result.rewritten.push(relFile);
				}
			}
		}

		for (const generatedRel of listGeneratedReferenceFiles(
			skillDir,
			plan.skill,
		)) {
			const refPath = generatedRel.slice(`${plan.skill}/references/`.length);
			if (!plan.refPaths.has(refPath)) {
				const fullPath = join(root, generatedRel);
				if (!options.dryRun) unlinkSync(fullPath);
				result.removed.push(generatedRel);
			}
		}
	}

	return result;
}
