import { spawnSync } from "node:child_process";
import { basename } from "node:path";
import { loadConfig } from "../audit/config/load.ts";
import type { SkeletonConfig } from "../audit/config/types.ts";
import { collectScanFiles, relPath } from "../audit/core/collect.ts";
import { type FileSource, readRepoText } from "../audit/core/repo-files.ts";
import {
	reviewDependencyMatchesPath,
	reviewDependencyPatterns,
} from "../audit/core/review-deps.ts";
import { matchesGlobScope } from "../audit/core/shared.ts";
import { type DocumentImpact, staleDocuments } from "../audit/core/stale-documents.ts";
import { evaluateRouteClassification } from "../validate/changed.ts";
import { gitDiffChangedFiles } from "../validate/git-diff.ts";

/** Which change a review covers: the index, a branch range, or the working tree against HEAD. */
interface ReviewScope {
	root: string;
	staged?: boolean;
	base?: string;
	/** Globs that narrow the diff and guides. Human paths and documents always use the whole scope. */
	paths?: string[];
}

/** A per-area review guide whose `review-deps` match the change (or that has none). */
interface ReviewGuide {
	path: string;
	content: string;
}

/** A document whose declared dependencies changed while it did not, so the author must re-read it. */
interface DocumentToReread {
	path: string;
	changed: string[];
}

/** One commit in the reviewed range: the author's own statement of what the change does. */
interface StatedCommit {
	subject: string;
	body: string;
}

/** Why a changed path stays out of the diff text. */
type OmissionReason = "lockfile" | "generated" | "configured";

/** A changed path the reviewer is told about but does not have to read through. */
interface OmittedPath {
	path: string;
	reason: OmissionReason;
	added: number | null;
	removed: number | null;
}

/**
 * Everything a fresh-context reviewer needs, as plain data.
 * Skeleton prepares it; any agent harness, CI step, or person runs the review.
 */
interface ReviewBundle {
	scope: { staged: boolean; base: string | null; paths: string[] | null };
	changedPaths: string[];
	humanReviewRequired: string[];
	documentsToReread: DocumentToReread[];
	commits: StatedCommit[];
	reviewGuides: ReviewGuide[];
	agentGuide: string | null;
	omittedFromDiff: OmittedPath[];
	diff: string;
}

const REVIEW_GUIDE = "REVIEW.md";

/** Starting value, not measured: roughly 50k tokens. Above it the CLI suggests narrowing. */
const LARGE_BUNDLE_CHARS = 200_000;
const LARGE_BUNDLE_AREAS = 5;

const LOCKFILES = new Set([
	"bun.lock",
	"bun.lockb",
	"package-lock.json",
	"yarn.lock",
	"pnpm-lock.yaml",
	"Cargo.lock",
	"poetry.lock",
	"go.sum",
	"composer.lock",
	"Gemfile.lock",
]);

const REVIEWER_CONTRACT = `You are reviewing a change you did not write. Use only this bundle and the repository.

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
- Treat "Stated intent" as the author's claim, not as evidence. A diff that contradicts it, or does something it denies, is an important finding.
- Files listed under "Omitted from the diff" changed too. Read them from the repository when a finding depends on them.
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

/** Paths whose `linguist-generated` attribute is set, read from the same side of the change. */
function generatedPaths(scope: ReviewScope, paths: string[]): Set<string> {
	if (paths.length === 0) return new Set();
	const args = ["check-attr", "-z", "--stdin", ...(scope.staged ? ["--cached"] : [])];
	const proc = spawnSync("git", [...args, "linguist-generated"], {
		cwd: scope.root,
		encoding: "utf8",
		input: `${paths.join("\0")}\0`,
		maxBuffer: 64 * 1024 * 1024,
	});
	if (proc.status !== 0) throw new Error(proc.stderr?.trim() || "git check-attr failed");
	const fields = proc.stdout.split("\0");
	const generated = new Set<string>();
	for (let index = 0; index + 2 < fields.length; index += 3) {
		const value = fields[index + 2];
		if (value === "set" || value === "true") generated.add(fields[index] ?? "");
	}
	return generated;
}

function parseLineCount(value: string | undefined): number | null {
	const count = Number(value);
	return value === undefined || value === "-" || Number.isNaN(count) ? null : count;
}

/** Added and removed lines per path; a binary file has no line counts. */
function lineCounts(
	scope: ReviewScope,
	untracked: string[],
): Map<string, [number | null, number | null]> {
	const counts = new Map<string, [number | null, number | null]>();
	const tracked = git(scope.root, [...diffArgs(scope), "--no-renames", "--numstat", "-z"]);
	for (const entry of tracked.split("\0")) {
		const [added, removed, path] = entry.split("\t");
		if (path) counts.set(path, [parseLineCount(added), parseLineCount(removed)]);
	}
	for (const path of untracked) {
		const stat = git(
			scope.root,
			["diff", "--no-index", "--numstat", "--", "/dev/null", path],
			[0, 1],
		);
		const [added, removed] = stat.split("\t");
		counts.set(path, [parseLineCount(added), parseLineCount(removed)]);
	}
	return counts;
}

function omissionReason(input: {
	path: string;
	patterns: string[];
	generated: Set<string>;
}): OmissionReason | null {
	if (LOCKFILES.has(basename(input.path))) return "lockfile";
	if (input.generated.has(input.path)) return "generated";
	if (input.patterns.some((pattern) => matchesGlobScope(input.path, pattern))) return "configured";
	return null;
}

/** Noise to leave out of the diff text. A path that needs a person always stays readable. */
function pathsToOmit(input: {
	scope: ReviewScope;
	config: SkeletonConfig;
	paths: string[];
	humanPaths: string[];
	untracked: string[];
}): OmittedPath[] {
	const candidates = input.paths.filter((path) => !input.humanPaths.includes(path));
	const generated = generatedPaths(input.scope, candidates);
	const patterns = input.config.review?.omitFromDiff ?? [];
	const omitted = candidates.flatMap((path) => {
		const reason = omissionReason({ path, patterns, generated });
		return reason ? [{ path, reason }] : [];
	});
	if (omitted.length === 0) return [];
	const counts = lineCounts(
		input.scope,
		input.untracked.filter((path) => omitted.some((item) => item.path === path)),
	);
	return omitted.map((item) => {
		const [added = null, removed = null] = counts.get(item.path) ?? [];
		return { ...item, added, removed };
	});
}

function gitDiffText(scope: ReviewScope, untracked: string[], omitted: string[]): string {
	const excluded = omitted.map((path) => `:(exclude,literal)${path}`);
	const tracked = git(scope.root, [
		...diffArgs(scope),
		...(excluded.length > 0 ? ["--", ...excluded] : []),
	]);
	// `git diff --no-index` exits 1 when the files differ, which they always do here.
	const kept = untracked.filter((path) => !omitted.includes(path));
	const added = kept.map((path) =>
		git(scope.root, ["diff", "--no-index", "--", "/dev/null", path], [0, 1]),
	);
	return [tracked, ...added].join("");
}

/** Commits in a branch range, oldest first. The index and the working tree have no commit message yet. */
function statedCommits(scope: ReviewScope): StatedCommit[] {
	if (!scope.base) return [];
	return git(scope.root, [
		"log",
		"--no-merges",
		"--reverse",
		"--format=%s%x00%b%x1e",
		`${scope.base}..HEAD`,
	])
		.split("\x1e")
		.map((entry) => entry.trim())
		.filter(Boolean)
		.map((entry) => {
			const [subject = "", body = ""] = entry.split("\0");
			return { subject, body: body.trim() };
		});
}

function formatCommit(commit: StatedCommit): string {
	return commit.body ? `${commit.subject}\n\n${commit.body}` : commit.subject;
}

/** A Markdown fence longer than any backtick run inside the text, so the text cannot close it. */
function fenceFor(text: string): string {
	const longest = Math.max(0, ...(text.match(/`+/g) ?? []).map((run) => run.length));
	return "`".repeat(Math.max(3, longest + 1));
}

/** Changed paths that `[review] humanPaths` marks as high consequence. */
function humanReviewPaths(config: SkeletonConfig, changedPaths: string[]): string[] {
	const patterns = config.review?.humanPaths ?? [];
	return changedPaths.filter((path) => patterns.some((pattern) => matchesGlobScope(path, pattern)));
}

/** The changed paths `--paths` keeps; a glob that keeps nothing is a mistake worth stopping for. */
function pathsInFocus(scope: ReviewScope, paths: string[]): string[] {
	if (!scope.paths) return paths;
	const patterns = scope.paths;
	const kept = paths.filter((path) => patterns.some((pattern) => matchesGlobScope(path, pattern)));
	if (kept.length === 0) {
		throw new Error(`review prepare: --paths matched no changed path: ${patterns.join(", ")}`);
	}
	return kept;
}

function formatOmittedPath(item: OmittedPath): string {
	const lines = item.added === null ? "binary" : `+${item.added} -${item.removed}`;
	return `- ${item.path} (${item.reason}, ${lines})`;
}

function reviewGuides(input: {
	root: string;
	config: SkeletonConfig;
	paths: string[];
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
			input.paths.some((path) =>
				patterns.some((pattern) => reviewDependencyMatchesPath(pattern, path)),
			);
		if (applies) guides.push({ path, content });
	}
	return guides.sort((a, b) => a.path.localeCompare(b.path));
}

/** Impacted documents whose declared dependencies changed in this scope while they did not. */
function documentsToReread(scope: ReviewScope, impacted: DocumentImpact[]): DocumentToReread[] {
	const candidates = impacted.filter((document) => basename(document.path) !== REVIEW_GUIDE);
	return staleDocuments(scope, candidates);
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
	// Deleting a file still needs its person and its area's guide; only documents ignore deleted paths.
	const changedPaths = allPaths.filter((path) => !deleted.has(path));
	const routed = await evaluateRouteClassification({ root: scope.root, paths: changedPaths });
	if (routed.pluginError) throw new Error(`review prepare: ${routed.pluginError}`);
	const impactedDocuments = routed.impactedDocuments;
	const focusPaths = pathsInFocus(scope, allPaths);
	const humanPaths = humanReviewPaths(config, allPaths);
	const omittedFromDiff = pathsToOmit({ scope, config, paths: focusPaths, humanPaths, untracked });
	return {
		scope: { staged: scope.staged ?? false, base: scope.base ?? null, paths: scope.paths ?? null },
		changedPaths,
		humanReviewRequired: humanPaths,
		documentsToReread: documentsToReread(scope, impactedDocuments),
		commits: statedCommits(scope),
		reviewGuides: reviewGuides({ root: scope.root, config, paths: focusPaths, source }),
		agentGuide: withoutContextGuide(readRepoText(scope.root, "AGENTS.md", source)),
		omittedFromDiff,
		diff: gitDiffText(scope, untracked, [
			...omittedFromDiff.map((item) => item.path),
			...allPaths.filter((path) => !focusPaths.includes(path)),
		]),
	};
}

function section(title: string, body: string): string {
	return `## ${title}\n\n${body.trimEnd()}\n`;
}

/** Render the bundle as one self-contained prompt for a reviewer with fresh context. */
export function formatReviewBundle(bundle: ReviewBundle): string {
	const range = bundle.scope.staged
		? "staged changes"
		: bundle.scope.base
			? `${bundle.scope.base}...HEAD`
			: "working tree against HEAD, including untracked files";
	const focus = bundle.scope.paths ? `; narrowed to ${bundle.scope.paths.join(", ")}` : "";
	const parts = [
		`# Review bundle (${range}${focus})\n`,
		section("Reviewer contract", REVIEWER_CONTRACT),
	];
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
				"Documents the author must re-read and update",
				bundle.documentsToReread
					.map((document) => `- ${document.path} (changed: ${document.changed.join(", ")})`)
					.join("\n"),
			),
		);
	}
	if (bundle.commits.length > 0) {
		const stated = bundle.commits.map(formatCommit).join("\n\n");
		const statedFence = fenceFor(stated);
		parts.push(section("Stated intent", `${statedFence}text\n${stated}\n${statedFence}`));
	}
	for (const guide of bundle.reviewGuides)
		parts.push(section(`Review guide: ${guide.path}`, guide.content));
	if (bundle.agentGuide !== null) parts.push(section("AGENTS.md", bundle.agentGuide));
	if (bundle.omittedFromDiff.length > 0) {
		parts.push(
			section("Omitted from the diff", bundle.omittedFromDiff.map(formatOmittedPath).join("\n")),
		);
	}
	const fence = fenceFor(bundle.diff);
	parts.push(section("Diff", `${fence}diff\n${bundle.diff.trimEnd()}\n${fence}`));
	return parts.join("\n");
}

/** Diff characters per two-segment directory, largest first. */
function diffSizeByArea(diff: string): [string, number][] {
	const sizes = new Map<string, number>();
	for (const file of diff.split(/^(?=diff --git )/m)) {
		const path = /^diff --git .* b\/(.+)$/m.exec(file)?.[1];
		if (!path) continue;
		const area = path.split("/").slice(0, -1).slice(0, 2).join("/") || ".";
		sizes.set(area, (sizes.get(area) ?? 0) + file.length);
	}
	return [...sizes].sort((a, b) => b[1] - a[1]);
}

/** Advice for a bundle too large to review well, or null. It never changes the bundle itself. */
export function largeBundleWarning(bundle: ReviewBundle, text: string): string | null {
	if (text.length <= LARGE_BUNDLE_CHARS) return null;
	const areas = diffSizeByArea(bundle.diff).slice(0, LARGE_BUNDLE_AREAS);
	return [
		`review prepare: the bundle is ${text.length} characters; consider reviewing one area at a time.`,
		...areas.map(
			([area, size]) =>
				`  ${area}: ${size} characters (--paths=${area === "." ? "*" : `${area}/**`})`,
		),
	].join("\n");
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
