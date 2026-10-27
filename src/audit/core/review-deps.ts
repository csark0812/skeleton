import { existsSync } from "node:fs";
import { globSync } from "tinyglobby";
import { selectorKind } from "./selectors.ts";
import { matchesGlobScope, normalizeRelPath } from "./shared.ts";

const REVIEW_DEPS_RE = /<!--\s*review-deps:\s*([^>]*?)-->/gi;
const GLOB_MAGIC_RE = /[*?{[]/;

interface ReviewDepsMarker {
	paths: string[];
	raw: string;
}

interface ResolvedReviewDependencies {
	patterns: string[];
	/** Repo-relative files, without selectors. */
	targets: string[];
	/**
	 * Selectors per target that is declared only through selectors
	 * (`package.json#scripts`). A target declared as a whole file has no entry here.
	 */
	selectors: Record<string, string[]>;
}

/**
 * A declared dependency: a path or glob, optionally narrowed by a selector to one JSON key path
 * (`file.json#a.b`), one Markdown section (`doc.md#install`), or one symbol (`src/run.ts#parseArgs`).
 */
interface ReviewDependencyRef {
	path: string;
	selector: string | null;
}

const SELECTOR_RE = /^[A-Za-z0-9_$@-]+(?:\.[A-Za-z0-9_$@-]+)*$/;

export function parseReviewDependency(pattern: string): ReviewDependencyRef {
	const hash = pattern.indexOf("#");
	if (hash === -1) return { path: pattern, selector: null };
	return { path: pattern.slice(0, hash), selector: pattern.slice(hash + 1) };
}

function assertValidSelector(pattern: string, ref: ReviewDependencyRef): void {
	if (ref.selector === null) return;
	if (isReviewDependencyGlob(ref.path)) {
		throw new Error(`Review dependency selector needs one file, not a glob: ${pattern}`);
	}
	if (!SELECTOR_RE.test(ref.selector)) {
		throw new Error(`Invalid review dependency selector: ${pattern}`);
	}
	if (selectorKind(ref.path, ref.selector) === "line") {
		throw new Error(
			`Review dependency selector cannot name lines; they move on every edit above them: ${pattern}`,
		);
	}
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
	return GLOB_MAGIC_RE.test(parseReviewDependency(pattern).path);
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
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: one pass keeps path safety, selector rules, and glob expansion for each declared dependency together
export function resolveReviewDependencies(
	root: string,
	patterns: string[],
): ResolvedReviewDependencies {
	const targets = new Set<string>();
	const wholeFiles = new Set<string>();
	const selectors = new Map<string, Set<string>>();
	for (const pattern of patterns) {
		const ref = parseReviewDependency(pattern);
		if (!isSafeReviewDependencyPath(ref.path)) {
			throw new Error(`Invalid review dependency path: ${pattern}`);
		}
		assertValidSelector(pattern, ref);
		if (!isReviewDependencyGlob(ref.path)) {
			if (!existsSync(`${root}/${ref.path}`)) {
				throw new Error(`Review dependency path is missing: ${pattern}`);
			}
			targets.add(ref.path);
			if (ref.selector === null) wholeFiles.add(ref.path);
			else selectors.set(ref.path, (selectors.get(ref.path) ?? new Set()).add(ref.selector));
			continue;
		}
		for (const match of globSync(ref.path, {
			cwd: root,
			onlyFiles: true,
			dot: true,
			ignore: [".git/**"],
		})) {
			const target = normalizeRelPath(match);
			targets.add(target);
			wholeFiles.add(target);
		}
	}
	return {
		patterns: [...new Set(patterns)].sort(),
		targets: [...targets].sort(),
		selectors: Object.fromEntries(
			[...selectors]
				.filter(([target]) => !wholeFiles.has(target))
				.map(([target, keys]) => [target, [...keys].sort()]),
		),
	};
}

/** Path matching ignores a selector: any change to the file pulls the document into validation. */
export function reviewDependencyMatchesPath(pattern: string, relPath: string): boolean {
	const { path } = parseReviewDependency(pattern);
	return isReviewDependencyGlob(path)
		? matchesGlobScope(relPath, path)
		: normalizeRelPath(relPath) === path;
}
