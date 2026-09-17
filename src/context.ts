import { createHash } from "node:crypto";
import { globSync } from "tinyglobby";
import { loadConfig } from "./audit/config/load.ts";
import { collectScanFiles } from "./audit/core/collect.ts";
import { type FileSource, readRepoText } from "./audit/core/repo-files.ts";
import {
	resolveReviewDependencies,
	reviewDependencyMatchesPath,
	reviewDependencyPatterns,
} from "./audit/core/review-deps.ts";
import { normalizeRelPath } from "./audit/core/shared.ts";
import { collectSsotEntries } from "./audit/core/ssot-collect.ts";

const DEFAULT_MAX_CHARS = 12_000;

export type ContextReview = "matches-recorded-review" | "changed-since-review" | "unreviewed";

export interface ContextSource {
	path: string;
	excerpt: string;
}

export interface ContextDocument {
	path: string;
	summary: string;
	excerpt: string;
	sources: ContextSource[];
	tests: ContextSource[];
	review: ContextReview;
}

export interface ContextResult {
	documents: ContextDocument[];
	omitted: string[];
}

export interface ContextOptions {
	root: string;
	query?: string;
	path?: string;
	staged?: boolean;
	maxChars?: number;
}

type ReviewLock = {
	documents?: Record<
		string,
		{ documentHash?: string; reviewDependencies?: Record<string, string> }
	>;
};

function digest(content: string): string {
	return `sha256:${createHash("sha256").update(content, "utf8").digest("hex")}`;
}

function readLock(root: string, source: FileSource, lockfile: string): ReviewLock | null {
	const content = readRepoText(root, lockfile, source);
	if (!content) return null;
	try {
		const parsed: unknown = JSON.parse(content);
		return typeof parsed === "object" && parsed !== null ? (parsed as ReviewLock) : null;
	} catch {
		return null;
	}
}

function queryTerms(query: string | undefined): string[] {
	return [...new Set((query ?? "").toLowerCase().match(/[a-z0-9_]+/g) ?? [])].filter(
		(term) => term.length > 1,
	);
}

function score(text: string, terms: string[]): number {
	const lower = text.toLowerCase();
	return terms.reduce((total, term) => total + (lower.includes(term) ? 1 : 0), 0);
}

function focusedTests(root: string, sourcePaths: string[], source: FileSource): ContextSource[] {
	const terms = sourcePaths
		.flatMap((path) => path.toLowerCase().match(/[a-z0-9_]+/g) ?? [])
		.filter((term) => term.length > 2 && !["src", "index", "main"].includes(term));
	if (terms.length === 0) return [];
	return globSync(["**/*.{test,spec}.{ts,tsx,js,jsx,mjs,cjs,py}", "**/test_*.py"], {
		cwd: root,
		ignore: [
			"**/.git/**",
			"**/node_modules/**",
			"**/dist/**",
			"**/test-results/**",
			"**/vendor/**",
		],
	})
		.map(normalizeRelPath)
		.map((path) => ({ path, content: readRepoText(root, path, source) }))
		.filter((item): item is { path: string; content: string } => item.content !== null)
		.map((item) => ({ ...item, relevance: score(`${item.path}\n${item.content}`, terms) }))
		.filter((item) => item.relevance > 0)
		.sort((a, b) => b.relevance - a.relevance || a.path.localeCompare(b.path))
		.slice(0, 1)
		.map(({ path, content }) => ({ path, excerpt: content }));
}

function boundedExcerpts(entries: ContextSource[], available: number, terms: string[]) {
	let chars = 0;
	const items: ContextSource[] = [];
	for (const entry of entries) {
		if (chars >= available) break;
		const value = excerpt(entry.excerpt, available - chars, terms);
		chars += value.length;
		items.push({ path: entry.path, excerpt: value });
	}
	return { items, chars };
}

function excerpt(content: string, remaining: number, terms: string[]): string {
	const length = Math.min(remaining, 1_600);
	if (content.length <= length) return content;
	let strongestStart = 0;
	let strongestScore = 0;
	let offset = 0;
	for (const line of content.split("\n")) {
		const start = Math.max(0, offset - 400);
		const lower = content.slice(start, start + length).toLowerCase();
		const relevance = terms.reduce(
			(total, term) => total + (lower.includes(term) ? term.length : 0),
			0,
		);
		if (relevance > strongestScore) {
			strongestStart = start;
			strongestScore = relevance;
		}
		offset += line.length + 1;
	}
	const start = strongestStart;
	const end = Math.min(content.length, start + Math.max(0, length - 1));
	return `${start > 0 ? "…\n" : ""}${content.slice(start, end)}${end < content.length ? "…" : ""}`;
}

function reviewStatus(input: {
	document: string;
	content: string;
	sources: Array<{ path: string; content: string | null }>;
	lock: ReviewLock | null;
}): ContextReview {
	const entry = input.lock?.documents?.[input.document];
	if (
		!(entry?.documentHash && entry.reviewDependencies) ||
		entry.documentHash !== digest(input.content)
	)
		return "unreviewed";
	return input.sources.every(
		(source) =>
			source.content !== null && entry.reviewDependencies?.[source.path] === digest(source.content),
	)
		? "matches-recorded-review"
		: "changed-since-review";
}

/** Build bounded, read-only evidence from canonical papers and their declared source owners. */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity lint/complexity/noExcessiveLinesPerFunction: selection, bounds, and evidence construction share one public read-only evaluation.
export function evaluateContext(options: ContextOptions): ContextResult {
	if ((options.query ? 1 : 0) + (options.path ? 1 : 0) !== 1)
		throw new Error("context: provide exactly one query or path");
	const source: FileSource = options.staged ? "index" : "worktree";
	const target = options.path ? normalizeRelPath(options.path) : undefined;
	if (target && (target.startsWith("/") || target.startsWith("../") || target.includes("/../")))
		throw new Error("context: path must stay inside the repository");
	const config = loadConfig(options.root);
	const files = collectScanFiles(config, options.root);
	const ssot = collectSsotEntries(files, options.root).entries;
	const terms = queryTerms(options.query);
	const lock = readLock(
		options.root,
		source,
		normalizeRelPath(config.reviewProof?.lockfile ?? ".skeleton/review-lock.json"),
	);
	const maxChars = options.maxChars ?? DEFAULT_MAX_CHARS;
	let used = 0;
	const omitted: string[] = [];
	const documents = ssot
		// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: one document needs source, query, and bounds decisions before it can be returned.
		.map((entry) => {
			const content = readRepoText(options.root, entry.path, source);
			if (content === null) return null;
			const dependencyPatterns = reviewDependencyPatterns(content);
			const dependencies = resolveReviewDependencies(options.root, dependencyPatterns).targets;
			const matchesPath = target
				? dependencyPatterns.some((pattern) => reviewDependencyMatchesPath(pattern, target))
				: false;
			const matchesQuery = target
				? false
				: score(`${entry.summary}\n${entry.path}\n${content}`, terms) > 0;
			if (!(matchesPath || matchesQuery)) return null;
			return {
				entry,
				content,
				dependencies,
				relevance: target ? 1 : score(`${entry.summary}\n${entry.path}\n${content}`, terms),
			};
		})
		.filter((item): item is NonNullable<typeof item> => item !== null)
		.sort((a, b) => b.relevance - a.relevance || a.entry.path.localeCompare(b.entry.path))
		.flatMap(({ entry, content, dependencies }) => {
			if (used >= maxChars) {
				omitted.push(entry.path);
				return [];
			}
			const sourceEntries = dependencies.map((path) => ({
				path,
				content: readRepoText(options.root, path, source),
			}));
			const excerptTerms = target ? target.split(/[/.]/).filter(Boolean) : terms;
			const documentExcerpt = excerpt(content, maxChars - used, excerptTerms);
			used += documentExcerpt.length;
			const sourceExcerpts = boundedExcerpts(
				sourceEntries.flatMap((dependency) =>
					dependency.content === null
						? []
						: [{ path: dependency.path, excerpt: dependency.content }],
				),
				maxChars - used,
				excerptTerms,
			);
			used += sourceExcerpts.chars;
			const testExcerpts = boundedExcerpts(
				focusedTests(options.root, dependencies, source),
				maxChars - used,
				excerptTerms,
			);
			used += testExcerpts.chars;
			return [
				{
					path: entry.path,
					summary: entry.summary,
					excerpt: documentExcerpt,
					sources: sourceExcerpts.items,
					tests: testExcerpts.items,
					review: reviewStatus({ document: entry.path, content, sources: sourceEntries, lock }),
				},
			];
		});
	return { documents, omitted };
}

export function formatContext(result: ContextResult): string {
	if (result.documents.length === 0) return "no-context\tno canonical document matched\n";
	const lines: string[] = [];
	for (const document of result.documents) {
		lines.push(`document\t${document.path}\t${document.review}`);
		if (document.review === "changed-since-review")
			lines.push(
				`action\t${document.path}\tBefore finishing, compare every claim in the final document with the returned sources and correct every mismatch.`,
			);
		lines.push(document.excerpt);
		for (const source of document.sources) lines.push(`source\t${source.path}`, source.excerpt);
		for (const test of document.tests) lines.push(`test\t${test.path}`, test.excerpt);
	}
	if (result.omitted.length) lines.push(`omitted\t${result.omitted.join(",")}`);
	return `${lines.join("\n\n")}\n`;
}
