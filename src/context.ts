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
const EXCERPT_MAX_CHARS = 3_600;
const EXCERPT_WINDOW_CHARS = 1_100;
const QUERY_STOP_TERMS = new Set([
	"current",
	"important",
	"constraints",
	"source",
	"sources",
	"file",
	"files",
	"path",
	"paths",
	"code",
	"docs",
	"documentation",
	"test",
	"tests",
]);

export type ContextReview = "matches-recorded-review" | "changed-since-review" | "unreviewed";

export interface ContextSource {
	path: string;
	excerpt: string;
	command?: string;
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
	const terms = [...new Set((query ?? "").toLowerCase().match(/[a-z0-9_]+/g) ?? [])].filter(
		(term) => term.length > 1,
	);
	const specific = terms.filter((term) => !QUERY_STOP_TERMS.has(term));
	return specific.length > 0 ? specific : terms;
}

function score(text: string, terms: string[]): number {
	const lower = text.toLowerCase();
	return terms.reduce((total, term) => total + (lower.includes(term) ? 1 : 0), 0);
}

function focusedTestCommand(root: string, path: string, source: FileSource): string | undefined {
	const packageJson = readRepoText(root, "package.json", source);
	if (!packageJson) return;
	try {
		const parsed: unknown = JSON.parse(packageJson);
		if (typeof parsed !== "object" || parsed === null) return;
		const scripts = (parsed as { scripts?: unknown }).scripts;
		if (typeof scripts !== "object" || scripts === null) return;
		const test = (scripts as { test?: unknown }).test;
		return typeof test === "string" && /^bun test(?:\s|$)/.test(test)
			? `bun test ${path}`
			: undefined;
	} catch {
		// Invalid package metadata cannot supply a trustworthy command.
	}
}

function focusedTestRelevance(input: {
	path: string;
	content: string;
	sourcePaths: string[];
	sourceStems: string[];
	terms: string[];
}): number {
	const lowerPath = input.path.toLowerCase();
	const matchingName = input.sourceStems.some(
		(stem) =>
			stem.length > 0 &&
			(lowerPath.includes(`/${stem}.test.`) || lowerPath.includes(`/${stem}.spec.`)),
	);
	const importsSource = input.sourcePaths.some((path) => input.content.includes(path));
	return (
		score(`${input.path}\n${input.content}`, input.terms) +
		(matchingName ? 1_000 : 0) +
		(importsSource ? 100 : 0)
	);
}

function focusedTests(root: string, sourcePaths: string[], source: FileSource): ContextSource[] {
	const terms = sourcePaths
		.flatMap((path) => path.toLowerCase().match(/[a-z0-9_]+/g) ?? [])
		.filter((term) => term.length > 2 && !["src", "index", "main"].includes(term));
	const sourceStems = sourcePaths.map(
		(path) =>
			path
				.split("/")
				.at(-1)
				?.replace(/\.[^.]+$/, "")
				.toLowerCase() ?? "",
	);
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
		.map((item) => ({
			...item,
			relevance: focusedTestRelevance({ ...item, sourcePaths, sourceStems, terms }),
		}))
		.filter((item) => item.relevance > 0)
		.sort((a, b) => b.relevance - a.relevance || a.path.localeCompare(b.path))
		.slice(0, 1)
		.map(({ path, content }) => ({
			path,
			excerpt: content,
			command: focusedTestCommand(root, path, source),
		}));
}

function boundedExcerpts(entries: ContextSource[], available: number, terms: string[]) {
	let chars = 0;
	const items: ContextSource[] = [];
	for (const entry of entries) {
		if (chars >= available) break;
		const value = excerpt(entry.excerpt, available - chars, terms);
		chars += value.length;
		items.push({ path: entry.path, excerpt: value, command: entry.command });
	}
	return { items, chars };
}

interface ExcerptWindow {
	start: number;
	end: number;
	relevance: number;
}

function candidateWindows(content: string, windowLength: number, terms: string[]): ExcerptWindow[] {
	let offset = 0;
	const candidates: ExcerptWindow[] = [];
	for (const line of content.split("\n")) {
		const start = Math.max(0, offset - 300);
		const end = Math.min(content.length, start + windowLength);
		const lower = content.slice(start, end).toLowerCase();
		const relevance = terms.reduce(
			(total, term) => total + (lower.includes(term) ? term.length : 0),
			0,
		);
		if (relevance > 0) candidates.push({ start, end, relevance });
		offset += line.length + 1;
	}
	return candidates.sort((a, b) => b.relevance - a.relevance || a.start - b.start);
}

function strongestSeparatedWindows(candidates: ExcerptWindow[], limit: number): ExcerptWindow[] {
	const selected: ExcerptWindow[] = [];
	for (const candidate of candidates) {
		if (selected.length >= limit) break;
		if (selected.every((item) => candidate.end <= item.start || candidate.start >= item.end)) {
			selected.push(candidate);
		}
	}
	return selected.sort((a, b) => a.start - b.start);
}

function excerpt(content: string, remaining: number, terms: string[]): string {
	const length = Math.min(remaining, EXCERPT_MAX_CHARS);
	if (content.length <= length) return content;
	const windowCount = Math.max(1, Math.min(3, Math.floor(length / EXCERPT_WINDOW_CHARS)));
	const windows = strongestSeparatedWindows(
		candidateWindows(content, EXCERPT_WINDOW_CHARS, terms),
		windowCount,
	);
	if (windows.length === 0) windows.push({ start: 0, end: length - 1, relevance: 0 });
	return windows
		.map(({ start, end }, index) => {
			const prefix = start > 0 || index > 0 ? "…\n" : "";
			const suffix = end < content.length ? "…" : "";
			return `${prefix}${content.slice(start, end)}${suffix}`;
		})
		.join("\n");
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

function formattedTests(tests: ContextSource[]): string[] {
	return tests.flatMap((test) => [
		`test\t${test.path}`,
		test.excerpt,
		...(test.command ? [`test-command\t${test.command}`] : []),
	]);
}

function formattedDocument(document: ContextDocument): string[] {
	const lines = [`document\t${document.path}\t${document.review}`];
	if (document.review === "changed-since-review") {
		lines.push(
			`action\t${document.path}\tReturned source excerpts are authoritative current behavior. Preserve every unrelated source value exactly. Before finishing, compare every claim in the final document with those sources, update every stale claim, and never copy a stale document value over a source value.`,
		);
		for (const source of document.sources) lines.push(`source\t${source.path}`, source.excerpt);
		lines.push(...formattedTests(document.tests));
		lines.push(`stale-document\t${document.path}`, document.excerpt);
		return lines;
	}
	lines.push(document.excerpt);
	for (const source of document.sources) lines.push(`source\t${source.path}`, source.excerpt);
	lines.push(...formattedTests(document.tests));
	return lines;
}

export function formatContext(result: ContextResult): string {
	if (result.documents.length === 0)
		return (
			[
				"no-context\tno canonical document matched",
				"action\tno-context\tInspect the relevant code, tests, and nearby documentation to find the canonical owner. If an owner exists, repair its source-of-truth summary, content, or review-deps so this request can find it. If no owner exists and the subject is durable behavior (a feature, policy, workflow, or architectural contract), create canonical documentation with a source-of-truth summary and review-deps for its implementation. A --path miss must gain an owning document. For a read-only task, report the gap and proposed document follow-up without editing. Skip one-off debugging details and transient implementation facts. Rerun this exact context request and continue until it returns the owner.",
			].join("\n") + "\n"
		);
	const lines = result.documents.flatMap(formattedDocument);
	if (result.omitted.length) lines.push(`omitted\t${result.omitted.join(",")}`);
	return `${lines.join("\n\n")}\n`;
}
