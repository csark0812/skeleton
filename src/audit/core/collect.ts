import { existsSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { globSync } from "tinyglobby";
import { mergedExcludes } from "../config/load.ts";
import type { SkeletonConfig } from "../config/types.ts";
import { extractScanRootsFromInclude, matchesGlobScope, normalizeRelPath } from "./shared.ts";
import { type SkillIndex, skillCollectAugments } from "./skill-roots.ts";

const MARKDOWN_GLOBS = ["**/*.md", "**/*.mdc"];

function isMarkdownFile(absPath: string): boolean {
	return absPath.endsWith(".md") || absPath.endsWith(".mdc");
}

function shouldExclude(relPath: string, exclude: string[]): boolean {
	return exclude.some((pattern) => matchesGlobScope(relPath, pattern));
}

function expandPatterns(root: string, patterns: string[], exclude: string[]): string[] {
	const files = new Set<string>();
	for (const pattern of patterns) {
		for (const abs of globSync(pattern, {
			cwd: root,
			absolute: true,
			onlyFiles: true,
			dot: true,
		})) {
			if (!isMarkdownFile(abs)) continue;
			const rel = normalizeRelPath(relative(root, abs));
			if (shouldExclude(rel, exclude)) continue;
			files.add(abs);
		}
	}
	return [...files];
}

export function collectScanFiles(
	config: SkeletonConfig,
	root: string,
	skillIndex?: SkillIndex,
): string[] {
	const exclude = mergedExcludes(config);
	const includePatterns = [...config.scan.include];
	if (skillIndex) {
		includePatterns.push(...skillCollectAugments(skillIndex));
	}
	return expandPatterns(root, includePatterns, exclude);
}

export function collectBannedFiles(config: SkeletonConfig, root: string): string[] {
	if (config.scan.banned.length === 0) return [];
	const exclude = mergedExcludes(config);
	const files = new Set<string>();
	for (const pattern of config.scan.banned) {
		for (const abs of globSync(pattern, {
			cwd: root,
			absolute: true,
			onlyFiles: true,
			dot: false,
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
		})) {
			const rel = normalizeRelPath(relative(root, abs));
			if (shouldExclude(rel, exclude)) continue;
			files.add(rel);
		}
	}
	return [...files];
}

export function collectDocMetaPaths(
	config: SkeletonConfig,
	root: string,
	registryPaths: string[],
	skillIndex?: SkillIndex,
): string[] {
	const paths: string[] = [];

	for (const abs of expandPatterns(root, ["docs/*/README.md"], mergedExcludes(config))) {
		paths.push(normalizeRelPath(relative(root, abs)));
	}

	const extras = ["docs/README.md", ".skeleton/registry.md"];
	for (const file of extras) {
		const abs = join(root, file);
		if (existsSync(abs)) paths.push(normalizeRelPath(file));
	}

	for (const rel of registryPaths) {
		if (!rel.endsWith(".md") && !rel.endsWith(".mdc")) continue;
		const abs = join(root, rel);
		if (existsSync(abs)) paths.push(normalizeRelPath(rel));
	}

	for (const abs of collectScanFiles(config, root, skillIndex)) {
		const content = readFileSync(abs, "utf8");
		if (/<!--\s*doc-meta:/.test(content)) {
			paths.push(normalizeRelPath(relative(root, abs)));
		}
	}

	return [...new Set(paths)];
}

export function validateScanRoots(config: SkeletonConfig, root: string): string[] {
	const missing: string[] = [];
	for (const tree of extractScanRootsFromInclude(config.scan.include)) {
		if (!existsSync(join(root, tree))) missing.push(tree);
	}
	return missing;
}

export function filterDocMetaPaths(docMetaPaths: string[], paths: string[]): string[] {
	if (paths.length === 0) return docMetaPaths;
	const normalizedPaths = paths.map((path) => normalizeRelPath(path));
	return docMetaPaths.filter((rel) =>
		normalizedPaths.some((path) => rel === path || rel.startsWith(`${path}/`)),
	);
}

export function filterToPaths(files: string[], paths: string[], root: string): string[] {
	const normalizedPaths = paths.map((path) => normalizeRelPath(path));
	return files.filter((abs) => {
		const rel = normalizeRelPath(relative(root, abs));
		return normalizedPaths.some((path) => rel === path || rel.startsWith(`${path}/`));
	});
}

export function readFileContent(absPath: string): string {
	return readFileSync(absPath, "utf8");
}

export function relPath(absPath: string, root: string): string {
	return normalizeRelPath(relative(root, absPath));
}
