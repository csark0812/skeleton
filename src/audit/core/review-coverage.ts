import { globSync } from "tinyglobby";
import type { SkeletonConfig } from "../config/types.ts";
import { collectScanFiles, relPath } from "./collect.ts";
import { type FileSource, readRepoText } from "./repo-files.ts";
import { reviewDependencyMatchesPath, reviewDependencyPatterns } from "./review-deps.ts";
import { matchesGlobScope, normalizeRelPath } from "./shared.ts";
import type { SkillIndex } from "./skill-roots.ts";

export const DEFAULT_REVIEW_COVERAGE_INCLUDE = [
	"**/*.{ts,tsx,js,jsx,mjs,cjs,py}",
	"package.json",
	"project.json",
];

export const DEFAULT_REVIEW_COVERAGE_EXCLUDE = [
	"**/__tests__/**",
	"**/*.test.*",
	"**/*.spec.*",
	"**/fixtures/**",
	"templates/**",
	"**/dist/**",
	"**/node_modules/**",
	"**/.venv/**",
	"**/.git/**",
	".skeleton/plugins/**",
];

export function reviewCoveragePatterns(config: SkeletonConfig): {
	include: string[];
	exclude: string[];
} {
	const configured = config.reviewCoverage;
	if (configured?.include && configured.include.length === 0) {
		return { include: [], exclude: [] };
	}
	return {
		include:
			configured?.include && configured.include.length > 0
				? configured.include
				: DEFAULT_REVIEW_COVERAGE_INCLUDE,
		exclude: [...DEFAULT_REVIEW_COVERAGE_EXCLUDE, ...(configured?.exclude ?? [])],
	};
}

export function pathRequiresReviewCoverage(relPath: string, config: SkeletonConfig): boolean {
	const { include, exclude } = reviewCoveragePatterns(config);
	if (include.length === 0) return false;
	const path = normalizeRelPath(relPath);
	if (exclude.some((pattern) => matchesGlobScope(path, pattern))) return false;
	return include.some((pattern) => matchesGlobScope(path, pattern));
}

export function collectReviewDependencyPatterns(input: {
	root: string;
	config: SkeletonConfig;
	skillIndex: SkillIndex;
	fileSource?: FileSource;
}): string[] {
	const patterns = new Set<string>();
	const source = input.fileSource ?? "worktree";
	for (const abs of collectScanFiles(input.config, input.root, input.skillIndex)) {
		const rel = relPath(abs, input.root);
		const content = readRepoText(input.root, rel, source);
		if (content === null) continue;
		for (const pattern of reviewDependencyPatterns(content)) patterns.add(pattern);
	}
	return [...patterns].sort();
}

export function pathHasReviewOwner(relPath: string, patterns: string[]): boolean {
	return patterns.some((pattern) => reviewDependencyMatchesPath(pattern, relPath));
}

export function collectReviewCoverageFiles(root: string, config: SkeletonConfig): string[] {
	const { include, exclude } = reviewCoveragePatterns(config);
	if (include.length === 0) return [];
	const files = new Set<string>();
	for (const pattern of include) {
		for (const match of globSync(pattern, {
			cwd: root,
			onlyFiles: true,
			dot: true,
			ignore: exclude,
		})) {
			const rel = normalizeRelPath(match);
			if (exclude.some((item) => matchesGlobScope(rel, item))) continue;
			files.add(rel);
		}
	}
	return [...files].sort();
}
