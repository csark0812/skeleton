import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { globSync } from "tinyglobby";
import { mergedExcludes } from "../config/load.ts";
import type { SkeletonConfig } from "../config/types.ts";
import { extractScanRootsFromInclude, matchesGlobScope, normalizeRelPath } from "./shared.ts";
import { isForeignSkillPath, type SkillIndex, skillCollectAugments } from "./skill-roots.ts";

const MARKDOWN_GLOBS = ["**/*.md", "**/*.mdc"];
const BUILTIN_INCLUDE_PATTERNS = [".skeleton/customize/**"];

function isMarkdownFile(absPath: string): boolean {
	return absPath.endsWith(".md") || absPath.endsWith(".mdc");
}

function shouldExclude(relPath: string, exclude: string[]): boolean {
	return exclude.some((pattern) => matchesGlobScope(relPath, pattern));
}

interface RememberMarkdownInput {
	byReal: Map<string, string>;
	root: string;
	abs: string;
	exclude: string[];
}

function rememberMarkdownFile(input: RememberMarkdownInput): void {
	const { byReal, root, abs, exclude } = input;
	if (!isMarkdownFile(abs)) return;
	const rel = normalizeRelPath(relative(root, abs));
	if (shouldExclude(rel, exclude)) return;
	let real: string;
	try {
		real = realpathSync(abs);
	} catch {
		real = abs;
	}
	const existing = byReal.get(real);
	if (existing === undefined || (abs === real && existing !== real)) {
		byReal.set(real, abs);
	}
}

function expandPatterns(root: string, patterns: string[], exclude: string[]): string[] {
	const byReal = new Map<string, string>();
	for (const pattern of patterns) {
		for (const abs of globSync(pattern, {
			cwd: root,
			absolute: true,
			onlyFiles: true,
			dot: true,
			ignore: exclude,
		})) {
			rememberMarkdownFile({ byReal, root, abs, exclude });
		}
	}
	return [...byReal.values()];
}

export function collectScanFiles(
	config: SkeletonConfig,
	root: string,
	skillIndex?: SkillIndex,
): string[] {
	const exclude = mergedExcludes(config);
	const includePatterns = [...BUILTIN_INCLUDE_PATTERNS, ...config.scan.include];
	if (skillIndex) {
		includePatterns.push(...skillCollectAugments(skillIndex));
	}
	const files = expandPatterns(root, includePatterns, exclude);
	// scan.include globs (e.g. `.claude/skills/**`) can still match foreign lockfile
	// trees; drop those so body lint stays with the owning repo.
	if (!skillIndex) return files;
	return files.filter((abs) => {
		const rel = normalizeRelPath(relative(root, abs));
		return !isForeignSkillPath(rel, skillIndex);
	});
}

export function collectBannedFiles(config: SkeletonConfig, root: string): string[] {
	const patterns = config.deny?.paths ?? [];
	if (patterns.length === 0) return [];
	const exclude = mergedExcludes(config);
	const files = new Set<string>();
	for (const pattern of patterns) {
		for (const abs of globSync(pattern, {
			cwd: root,
			absolute: true,
			onlyFiles: true,
			dot: false,
			ignore: exclude,
		})) {
			const rel = normalizeRelPath(relative(root, abs));
			if (shouldExclude(rel, exclude)) continue;
			files.add(abs);
		}
	}
	return [...files];
}

export function collectCoverageCandidateFiles(root: string, exclude: string[]): string[] {
	const files = new Set<string>();
	for (const pattern of MARKDOWN_GLOBS) {
		for (const abs of globSync(pattern, {
			cwd: root,
			absolute: true,
			onlyFiles: true,
			dot: false,
			// Repo-wide `**/*.md` must honor scan.exclude at crawl time — post-filter
			// alone still readdir's huge ignored trees (e.g. CocoaPods under examples/**).
			ignore: exclude,
		})) {
			const rel = normalizeRelPath(relative(root, abs));
			if (shouldExclude(rel, exclude)) continue;
			files.add(rel);
		}
	}
	return [...files];
}

/** Drop foreign lockfile-synced skill trees from doc-meta scope (linted upstream). */
export function excludeForeignSkillDocMetaPaths(
	docMetaPaths: string[],
	skillIndex?: SkillIndex,
): string[] {
	if (!skillIndex) return docMetaPaths;
	return docMetaPaths.filter((rel) => !isForeignSkillPath(rel, skillIndex));
}

interface DocMetaCollectContext {
	config: SkeletonConfig;
	root: string;
	registryPaths: string[];
	skillIndex?: SkillIndex;
}

function collectRegistryDocMeta(ctx: DocMetaCollectContext): string[] {
	const paths: string[] = [];
	for (const rel of ctx.registryPaths) {
		if (!(rel.endsWith(".md") || rel.endsWith(".mdc"))) continue;
		const abs = join(ctx.root, rel);
		if (existsSync(abs)) paths.push(normalizeRelPath(rel));
	}
	return paths;
}

function collectScannedDocMeta(ctx: DocMetaCollectContext): string[] {
	const paths: string[] = [];
	for (const abs of collectScanFiles(ctx.config, ctx.root, ctx.skillIndex)) {
		const content = readFileSync(abs, "utf8");
		if (/<!--\s*doc-meta:/.test(content)) {
			paths.push(normalizeRelPath(relative(ctx.root, abs)));
		}
	}
	return paths;
}

export function collectDocMetaPaths(ctx: DocMetaCollectContext): string[] {
	const paths: string[] = [];

	for (const abs of expandPatterns(ctx.root, ["docs/*/README.md"], mergedExcludes(ctx.config))) {
		paths.push(normalizeRelPath(relative(ctx.root, abs)));
	}

	const extras = ["docs/README.md"];
	for (const file of extras) {
		const abs = join(ctx.root, file);
		if (existsSync(abs)) paths.push(normalizeRelPath(file));
	}

	paths.push(...collectRegistryDocMeta(ctx));
	paths.push(...collectScannedDocMeta(ctx));

	return excludeForeignSkillDocMetaPaths([...new Set(paths)], ctx.skillIndex);
}

export function validateScanRoots(config: SkeletonConfig, root: string): string[] {
	const missing: string[] = [];
	for (const tree of extractScanRootsFromInclude(config.scan.include)) {
		if (!existsSync(join(root, tree))) missing.push(tree);
	}
	return missing;
}

export function filterDocMetaPaths(
	docMetaPaths: string[],
	paths: string[],
	skillIndex?: SkillIndex,
): string[] {
	if (paths.length === 0) return excludeForeignSkillDocMetaPaths(docMetaPaths, skillIndex);
	const normalizedPaths = paths.map((path) => normalizeRelPath(path));
	return excludeForeignSkillDocMetaPaths(
		docMetaPaths.filter((rel) =>
			normalizedPaths.some((path) => rel === path || rel.startsWith(`${path}/`)),
		),
		skillIndex,
	);
}

export function filterToPaths(files: string[], paths: string[], root: string): string[] {
	const normalizedPaths = paths.map((path) => normalizeRelPath(path));
	return files.filter((abs) => {
		const rel = normalizeRelPath(relative(root, abs));
		return normalizedPaths.some((path) => rel === path || rel.startsWith(`${path}/`));
	});
}

/**
 * When path-scoped, ensure explicitly requested markdown files on disk are present even if
 * `scan.exclude` dropped them from the normal scan set (e.g. `.claude/skills/**`).
 * Directory paths expand to all markdown under that tree.
 */
function addExplicitPath(out: Set<string>, root: string, raw: string): void {
	const rel = normalizeRelPath(raw);
	const abs = join(root, rel);
	if (!existsSync(abs)) return;

	if (isMarkdownFile(rel)) {
		out.add(abs);
		return;
	}

	try {
		if (!statSync(abs).isDirectory()) return;
	} catch {
		return;
	}

	for (const md of globSync("**/*.{md,mdc}", {
		cwd: abs,
		absolute: true,
		onlyFiles: true,
		dot: true,
	})) {
		out.add(md);
	}
}

export function includeExplicitMarkdownPaths(
	files: string[],
	paths: string[],
	root: string,
): string[] {
	const out = new Set(files);
	for (const raw of paths) {
		addExplicitPath(out, root, raw);
	}
	return [...out];
}

export function readFileContent(absPath: string): string {
	return readFileSync(absPath, "utf8");
}

export function relPath(absPath: string, root: string): string {
	return normalizeRelPath(relative(root, absPath));
}
