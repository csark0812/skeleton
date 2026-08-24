import { existsSync } from "node:fs";
import { globSync } from "tinyglobby";
import { matchesGlobScope, normalizeRelPath } from "./shared.ts";

const REVIEW_DEPS_RE = /<!--\s*review-deps:\s*([^>]*?)-->/gi;
const GLOB_MAGIC_RE = /[*?{[]/;

export interface ReviewDepsMarker {
	paths: string[];
	raw: string;
}

export interface ResolvedReviewDependencies {
	patterns: string[];
	targets: string[];
}

/** Parse review dependency markers outside fenced and inline code. */
export function parseReviewDepsMarkers(content: string): ReviewDepsMarker[] {
	const withoutCode = content.replace(/```[\s\S]*?```/g, "\n").replace(/`[^`\n]+`/g, " ");
	const out: ReviewDepsMarker[] = [];
	for (const match of withoutCode.matchAll(REVIEW_DEPS_RE)) {
		const raw = (match[1] ?? "").trim();
		const pathsMatch = /\bpaths\s*=\s*([^\s]+)/i.exec(raw);
		const paths = pathsMatch?.[1]
			? pathsMatch[1]
					.split(",")
					.map((path) => normalizeRelPath(path.trim()))
					.filter(Boolean)
			: [];
		out.push({ paths, raw });
	}
	return out;
}

export function reviewDependencyPatterns(content: string): string[] {
	return [...new Set(parseReviewDepsMarkers(content).flatMap((marker) => marker.paths))].sort();
}

export function isReviewDependencyGlob(pattern: string): boolean {
	return GLOB_MAGIC_RE.test(pattern);
}

export function isSafeReviewDependencyPath(value: string): boolean {
	const normalized = normalizeRelPath(value);
	return (
		value.length > 0 &&
		value === normalized &&
		normalized !== "." &&
		normalized !== ".." &&
		!normalized.startsWith("/") &&
		!normalized.startsWith("../") &&
		!normalized.includes("/../") &&
		!/^[A-Za-z]:\//.test(normalized)
	);
}

/** Resolve all declared paths against the repository, without scan-perimeter filtering. */
export function resolveReviewDependencies(
	root: string,
	patterns: string[],
): ResolvedReviewDependencies {
	const targets = new Set<string>();
	for (const pattern of patterns) {
		if (!isSafeReviewDependencyPath(pattern)) {
			throw new Error(`Invalid review dependency path: ${pattern}`);
		}
		if (!isReviewDependencyGlob(pattern)) {
			if (!existsSync(`${root}/${pattern}`)) {
				throw new Error(`Review dependency path is missing: ${pattern}`);
			}
			targets.add(pattern);
			continue;
		}
		for (const match of globSync(pattern, {
			cwd: root,
			onlyFiles: true,
			dot: true,
			ignore: [".git/**"],
		})) {
			targets.add(normalizeRelPath(match));
		}
	}
	return { patterns: [...new Set(patterns)].sort(), targets: [...targets].sort() };
}

export function reviewDependencyMatchesPath(pattern: string, relPath: string): boolean {
	return isReviewDependencyGlob(pattern)
		? matchesGlobScope(relPath, pattern)
		: normalizeRelPath(relPath) === pattern;
}
