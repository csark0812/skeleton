import { spawnSync } from "node:child_process";
import { readAtCommit } from "./git-meta.ts";
import { readRepoText } from "./repo-files.ts";
import { type Issue, issue } from "./report.ts";
import { parseReviewDependency } from "./review-deps.ts";
import { dependencyDigest } from "./review-digest.ts";

/**
 * A document goes stale when a change alters one of its declared `review-deps` but leaves the
 * document itself alone. Nothing records reviews: the change under check is the only evidence,
 * so a document that is still correct needs an edit or a skipped hook, never a stored stamp.
 */

/** Which change is checked: the index, a branch range, or the working tree against HEAD. */
export interface ChangeScope {
	root: string;
	staged?: boolean;
	base?: string;
}

/** The impact reasons `validate changed` derives from `review-deps` (see `discoverImpactedDocuments`). */
export interface DocumentImpact {
	path: string;
	reasons: Array<{
		kind: "changed-document" | "changed-review-dependency";
		dependency?: string;
		target?: string;
	}>;
}

export interface StaleDocument {
	path: string;
	/** Changed dependencies, in the order they were found. */
	changed: string[];
}

function git(root: string, args: string[]): string | null {
	const proc = spawnSync("git", args, { cwd: root, encoding: "utf8" });
	return proc.status === 0 ? proc.stdout.trim() : null;
}

interface ScopeSides {
	before: (path: string) => string | null;
	after: (path: string) => string | null;
}

/**
 * The two sides of a scope as file readers: before the change, and with it. Null without a
 * commit to compare against (no repository, or before the first commit): nothing can be stale.
 */
function scopeSides(scope: ChangeScope): ScopeSides | null {
	const head = git(scope.root, ["rev-parse", "--verify", "-q", "HEAD"]);
	if (head === null) return null;
	const atCommit = (sha: string) => (path: string) => readAtCommit(scope.root, sha, path);
	if (scope.base) {
		const mergeBase = git(scope.root, ["merge-base", scope.base, "HEAD"]);
		if (mergeBase === null) throw new Error(`No merge base between ${scope.base} and HEAD`);
		return { before: atCommit(mergeBase), after: atCommit(head) };
	}
	const source = scope.staged ? "index" : "worktree";
	return { before: atCommit(head), after: (path) => readRepoText(scope.root, path, source) };
}

/** Compare as a review would: selected JSON keys only, no package version, no doc-meta comment. */
function dependencyChanged(target: string, dependency: string, sides: ScopeSides): boolean {
	const before = sides.before(target);
	const after = sides.after(target);
	if (before === null || after === null) return before !== after;
	const ref = parseReviewDependency(dependency);
	const selectors = ref.selector !== null && ref.path === target ? [ref.selector] : undefined;
	return dependencyDigest(target, before, selectors) !== dependencyDigest(target, after, selectors);
}

function isDocumentChanged(document: DocumentImpact): boolean {
	return document.reasons.some((reason) => reason.kind === "changed-document");
}

/** Documents whose declared dependencies changed in this scope while they did not. */
export function staleDocuments(scope: ChangeScope, impacted: DocumentImpact[]): StaleDocument[] {
	const sides = scopeSides(scope);
	if (sides === null) return [];
	return impacted.flatMap((document) => {
		if (isDocumentChanged(document)) return [];
		const changed = changedTargets(document, sides);
		return changed.length > 0 ? [{ path: document.path, changed }] : [];
	});
}

function changedTargets(document: DocumentImpact, sides: ScopeSides): string[] {
	const changed = new Set<string>();
	for (const { target, dependency } of document.reasons) {
		if (target && dependency && dependencyChanged(target, dependency, sides)) changed.add(target);
	}
	return [...changed];
}

function remediation(document: string, staged: boolean): string {
	const fix = `Re-read ${document} in full against the changed files and update it in the same change.`;
	return staged
		? `${fix} If it is still correct, commit once without this hook (pre-commit: SKIP=<hook id> git commit …).`
		: fix;
}

/**
 * One issue per changed dependency, so the report prints a "changed:" line for each. A commit is
 * blocked (`--staged`); a branch range or the working tree is only warned, since nothing can
 * record that an unchanged document was checked.
 */
export function staleDocumentDiagnostics(scope: ChangeScope, impacted: DocumentImpact[]): Issue[] {
	const severity = scope.staged ? "error" : "warning";
	return staleDocuments(scope, impacted).flatMap((document) =>
		document.changed.map((target) =>
			issue("validate-changed", document.path, {
				code: "review-dependency-changed",
				message: `declared dependency changed but the document did not: ${target}`,
				link: target,
				severity,
				remediation: remediation(document.path, scope.staged ?? false),
			}),
		),
	);
}
