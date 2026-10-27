import { spawnSync } from "node:child_process";
import { basename } from "node:path";
import { loadConfig } from "../audit/config/load.ts";
import type { SkeletonConfig } from "../audit/config/types.ts";
import { collectScanFiles, relPath } from "../audit/core/collect.ts";
import { createContext } from "../audit/core/context.ts";
import { type FileSource, readRepoText } from "../audit/core/repo-files.ts";
import {
	reviewDependencyMatchesPath,
	reviewDependencyPatterns,
} from "../audit/core/review-deps.ts";
import { attestationsInRange } from "../audit/core/review-history.ts";
import { runReviewProofRule } from "../audit/core/review-proof.ts";
import { matchesGlobScope } from "../audit/core/shared.ts";
import { evaluateRouteClassification } from "../validate/changed.ts";
import { gitDiffChangedFiles } from "../validate/git-diff.ts";

/** Which change a review covers: the index, a branch range, or the working tree against HEAD. */
export interface ReviewScope {
	root: string;
	staged?: boolean;
	base?: string;
}

/** A per-area review guide whose `review-deps` match the change (or that has none). */
export interface ReviewGuide {
	path: string;
	content: string;
}

/** A document whose review proof no longer matches the change, so the author must re-read and attest it. */
export interface DocumentToReread {
	path: string;
	changed: string[];
}

/** A review recorded in this change. One whose text did not change is the likeliest rubber stamp. */
export interface AttestedDocument {
	path: string;
	textChanged: boolean;
	note: string | null;
	/** Changed paths among the document's declared review dependencies. */
	changedDependencies: string[];
}

/**
 * Everything a fresh-context reviewer needs, as plain data.
 * Skeleton prepares it; any agent harness, CI step, or person runs the review.
 */
export interface ReviewBundle {
	scope: { staged: boolean; base: string | null };
	changedPaths: string[];
	humanReviewRequired: string[];
	documentsToReread: DocumentToReread[];
	/** Documents this branch range attests (attest commits since the merge base). */
	attestedDocuments: AttestedDocument[];
	reviewGuides: ReviewGuide[];
	agentGuide: string | null;
	diff: string;
}

const REVIEW_GUIDE = "REVIEW.md";

export const REVIEWER_CONTRACT = `You are reviewing a change you did not write. Use only this bundle and the repository.

Report each finding on its own line:
<severity>\t<file>:<line>\t<bug class>\t<what breaks and why>

Severities:
- important: a real defect or a broken rule from AGENTS.md or a review guide. Must be fixed before merge.
- nit: optional improvement allowed by the review guides.
- pre-existing: a defect this diff did not introduce. Never blocks the author.

Rules:
- Cite the exact file and line. Do not guess file names.
- Name the bug class so the author can fix every instance, not one line.
- Do not report style unless a review guide asks for it.
- Do not re-report a finding the author already fixed or resolved with a reason.
- End with one line: "findings: <n> important, <n> nit, <n> pre-existing", or "no issues".`;

function diffArgs(scope: ReviewScope): string[] {
	if (scope.staged) return ["diff", "--cached"];
	return ["diff", scope.base ? `${scope.base}...HEAD` : "HEAD"];
}

function git(root: string, args: string[], okStatuses: number[] = [0]): string {
	const proc = spawnSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
	if (!okStatuses.includes(proc.status ?? -1)) {
		throw new Error(proc.stderr?.trim() || `git ${args[0]} failed`);
	}
	return proc.stdout;
}

/** New files the working-tree scope must cover; `git diff HEAD` omits them. */
function untrackedPaths(scope: ReviewScope): string[] {
	if (scope.staged || scope.base) return [];
	return git(scope.root, ["ls-files", "--others", "--exclude-standard"])
		.split("\n")
		.filter(Boolean);
}

function gitDiffText(scope: ReviewScope, untracked: string[]): string {
	const tracked = git(scope.root, diffArgs(scope));
	// `git diff --no-index` exits 1 when the files differ, which they always do here.
	const added = untracked.map((path) =>
		git(scope.root, ["diff", "--no-index", "--", "/dev/null", path], [0, 1]),
	);
	return [tracked, ...added].join("");
}

/** A Markdown fence longer than any backtick run inside the text, so the text cannot close it. */
function fenceFor(text: string): string {
	const longest = Math.max(0, ...(text.match(/`+/g) ?? []).map((run) => run.length));
	return "`".repeat(Math.max(3, longest + 1));
}

/** Changed paths that `[review] humanPaths` marks as high consequence. */
export function humanReviewPaths(config: SkeletonConfig, changedPaths: string[]): string[] {
	const patterns = config.review?.humanPaths ?? [];
	return changedPaths.filter((path) => patterns.some((pattern) => matchesGlobScope(path, pattern)));
}

function reviewGuides(input: {
	root: string;
	config: SkeletonConfig;
	changedPaths: string[];
	source: FileSource;
}): ReviewGuide[] {
	const guides: ReviewGuide[] = [];
	for (const abs of collectScanFiles(input.config, input.root)) {
		if (basename(abs) !== REVIEW_GUIDE) continue;
		const path = relPath(abs, input.root);
		const content = readRepoText(input.root, path, input.source);
		if (content === null) continue;
		const patterns = reviewDependencyPatterns(content);
		const applies =
			patterns.length === 0 ||
			input.changedPaths.some((changed) =>
				patterns.some((pattern) => reviewDependencyMatchesPath(pattern, changed)),
			);
		if (applies) guides.push({ path, content });
	}
	return guides.sort((a, b) => a.path.localeCompare(b.path));
}

/** Impacted documents whose current review proof fails, with the paths that pulled them in. */
function documentsToReread(input: {
	root: string;
	source: FileSource;
	impacted: Array<{ path: string; reasons: Array<{ target?: string }> }>;
}): DocumentToReread[] {
	const candidates = input.impacted.filter((document) => basename(document.path) !== REVIEW_GUIDE);
	if (candidates.length === 0) return [];
	const ctx = createContext({
		root: input.root,
		paths: candidates.map((document) => document.path),
		fileSource: input.source,
	});
	const errors = runReviewProofRule(ctx).filter((item) => item.severity === "error");
	// Without complete history no per-document check means anything.
	const blocking = errors.find((item) => item.code === "review-history-unavailable");
	if (blocking) {
		throw new Error(
			`review prepare: ${blocking.file}: ${blocking.message}. ${blocking.remediation ?? ""}`.trim(),
		);
	}
	const stale = new Set(errors.map((item) => item.file));
	return candidates
		.filter((document) => stale.has(document.path))
		.map((document) => ({
			path: document.path,
			changed: [...new Set(document.reasons.map((reason) => reason.target ?? document.path))],
		}));
}

/**
 * Reviews recorded in the change under review. Reviews are commits, so only a branch range
 * (merge base to HEAD) can contain them; the index and the working tree cannot.
 */
function attestedDocuments(input: {
	scope: ReviewScope;
	changedPaths: string[];
	source: FileSource;
}): AttestedDocument[] {
	if (!input.scope.base) return [];
	const mergeBase = git(input.scope.root, ["merge-base", input.scope.base, "HEAD"]).trim();
	const changed = new Set(input.changedPaths);
	const newest = new Map<string, { note: string | null }>();
	for (const line of attestationsInRange(input.scope.root, mergeBase, "HEAD")) {
		if (!newest.has(line.document)) newest.set(line.document, { note: line.note ?? null });
	}
	const out: AttestedDocument[] = [];
	for (const [path, review] of newest) {
		const content = readRepoText(input.scope.root, path, input.source) ?? "";
		const patterns = reviewDependencyPatterns(content);
		out.push({
			path,
			textChanged: changed.has(path),
			note: review.note,
			changedDependencies: input.changedPaths.filter((changedPath) =>
				patterns.some((pattern) => reviewDependencyMatchesPath(pattern, changedPath)),
			),
		});
	}
	// Unchanged text first: those are where a stamp can stand in for a reread.
	return out.sort(
		(a, b) => Number(a.textChanged) - Number(b.textChanged) || a.path.localeCompare(b.path),
	);
}

/** AGENTS.md without the agent-facing context guide, which tells a reviewer nothing. */
function withoutContextGuide(agents: string | null): string | null {
	if (agents === null) return null;
	const start = agents.indexOf("<!-- skeleton: context-guide -->");
	if (start === -1) return agents;
	const heading = agents.indexOf("## ", start);
	const headingEnd = heading === -1 ? -1 : agents.indexOf("\n", heading);
	// The guide runs until the next heading of the same or higher level, or the end of the file.
	const rest = headingEnd === -1 ? "" : agents.slice(headingEnd);
	const next = rest.search(/\n#{1,2} /);
	return `${agents.slice(0, start).trimEnd()}\n${next === -1 ? "" : rest.slice(next)}`;
}

/** Collect the diff and the repository rules a reviewer needs, without judging anything. */
export async function prepareReview(scope: ReviewScope): Promise<ReviewBundle> {
	const config = loadConfig(scope.root);
	const source: FileSource = scope.staged ? "index" : "worktree";
	const changed = gitDiffChangedFiles(scope);
	const untracked = untrackedPaths(scope);
	const allPaths = [...new Set([...changed.map((item) => item.path), ...untracked])].sort((a, b) =>
		a.localeCompare(b),
	);
	const deleted = new Set(changed.filter((item) => item.deleted).map((item) => item.path));
	// Deleting a high-consequence file still needs a person; deleted paths have no guides or docs.
	const changedPaths = allPaths.filter((path) => !deleted.has(path));
	const routed = await evaluateRouteClassification({ root: scope.root, paths: changedPaths });
	if (routed.pluginError) throw new Error(`review prepare: ${routed.pluginError}`);
	const impactedDocuments = routed.impactedDocuments;
	return {
		scope: { staged: scope.staged ?? false, base: scope.base ?? null },
		changedPaths,
		humanReviewRequired: humanReviewPaths(config, allPaths),
		documentsToReread: documentsToReread({ root: scope.root, source, impacted: impactedDocuments }),
		attestedDocuments: attestedDocuments({ scope, changedPaths, source }),
		reviewGuides: reviewGuides({ root: scope.root, config, changedPaths, source }),
		agentGuide: withoutContextGuide(readRepoText(scope.root, "AGENTS.md", source)),
		diff: gitDiffText(scope, untracked),
	};
}

function section(title: string, body: string): string {
	return `## ${title}\n\n${body.trimEnd()}\n`;
}

function attestedSection(documents: AttestedDocument[]): string | null {
	if (documents.length === 0) return null;
	const lines = documents.map((doc) => {
		const what = doc.textChanged ? "text changed" : "text unchanged";
		const deps =
			doc.changedDependencies.length > 0 ? `; changed: ${doc.changedDependencies.join(", ")}` : "";
		const note = doc.note ? `; checked: ${doc.note}` : "";
		return `- ${doc.path} (${what}${deps}${note})`;
	});
	return section(
		"Documents attested in this change",
		`Each line is a recorded reread. For every document whose text did not change, check that its claims still hold against the listed changes; report a stale claim as important.\n\n${lines.join("\n")}`,
	);
}

/** Render the bundle as one self-contained prompt for a reviewer with fresh context. */
export function formatReviewBundle(bundle: ReviewBundle): string {
	const range = bundle.scope.staged
		? "staged changes"
		: bundle.scope.base
			? `${bundle.scope.base}...HEAD`
			: "working tree against HEAD, including untracked files";
	const parts = [`# Review bundle (${range})\n`, section("Reviewer contract", REVIEWER_CONTRACT)];
	if (bundle.humanReviewRequired.length > 0) {
		parts.push(
			section(
				"Human review required",
				`A person must approve changes to these paths. An agent review does not count.\n\n${bundle.humanReviewRequired.map((path) => `- ${path}`).join("\n")}`,
			),
		);
	}
	if (bundle.documentsToReread.length > 0) {
		parts.push(
			section(
				"Documents the author must re-read and attest",
				bundle.documentsToReread
					.map((document) => `- ${document.path} (changed: ${document.changed.join(", ")})`)
					.join("\n"),
			),
		);
	}
	const attested = attestedSection(bundle.attestedDocuments);
	if (attested) parts.push(attested);
	for (const guide of bundle.reviewGuides)
		parts.push(section(`Review guide: ${guide.path}`, guide.content));
	if (bundle.agentGuide !== null) parts.push(section("AGENTS.md", bundle.agentGuide));
	const fence = fenceFor(bundle.diff);
	parts.push(section("Diff", `${fence}diff\n${bundle.diff.trimEnd()}\n${fence}`));
	return parts.join("\n");
}

/**
 * Hand the bundle to `[review] command` on stdin, so a separate process reviews it with fresh context.
 * Returns the command's exit status; its output goes to the caller's stdout and stderr.
 */
export function runReviewCommand(input: { root: string; command: string; bundle: string }): number {
	const proc = spawnSync(input.command, {
		cwd: input.root,
		input: input.bundle,
		shell: true,
		stdio: ["pipe", "inherit", "inherit"],
	});
	if (proc.error) throw proc.error;
	return proc.status ?? 1;
}
