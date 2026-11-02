import { join, relative } from "node:path";
import { collectScanFiles, readFileContent } from "../core/collect.ts";
import type { AuditContext } from "../core/context.ts";
import { type Issue, issue } from "../core/report.ts";
import {
	isReviewDependencyGlob,
	isSafeReviewDependencyPath,
	parseReviewDependency,
	parseReviewDepsMarkers,
	resolveReviewDependencies,
} from "../core/review-deps.ts";
import { resolveSelector, selectorKind } from "../core/selectors.ts";
import { normalizeRelPath } from "../core/shared.ts";

/** Validate opt-in repository dependencies for every scanned document. */
function runReviewDepsRule(ctx: AuditContext): Issue[] {
	const issues: Issue[] = [];
	const documentDependencies = new Map<string, string[]>();
	for (const abs of collectScanFiles(ctx.config, ctx.root, ctx.skillIndex)) {
		const path = normalizeRelPath(relative(ctx.root, abs));
		const dependencies: string[] = [];
		for (const marker of parseReviewDepsMarkers(readFileContent(abs))) {
			issues.push(...validateMarker(ctx.root, path, marker.paths));
			dependencies.push(...marker.paths);
		}
		if (dependencies.length > 0) documentDependencies.set(path, dependencies);
	}
	issues.push(...cycleIssues(ctx.root, documentDependencies));
	return issues;
}

function validateMarker(root: string, path: string, dependencies: string[]): Issue[] {
	if (dependencies.length === 0)
		return [issue("review-deps", path, "review-deps marker missing paths=")];
	return dependencies.flatMap((dependency) => validateDependency(root, path, dependency));
}

/**
 * A whole `package.json` changes on every dependency bump, so a document that only describes
 * scripts or the CLI would be re-read for nothing. Suggest naming the keys it describes.
 */
function broadManifestIssue(path: string, dependency: string): Issue | null {
	const ref = parseReviewDependency(dependency);
	if (ref.selector !== null || !/(^|\/)package\.json$/.test(ref.path)) return null;
	return issue("review-deps", path, {
		code: "review-dependency-broad",
		message: `depends on all of ${ref.path}, so every dependency bump asks for a re-read`,
		severity: "warning",
		remediation: `Name only the keys this document describes, e.g. ${ref.path}#scripts,${ref.path}#bin,${ref.path}#engines.`,
	});
}

/** A selector that names nothing never changes, so the document would never be asked for a re-read. */
function unresolvedSelectorIssue(root: string, path: string, dependency: string): Issue | null {
	const ref = parseReviewDependency(dependency);
	if (ref.selector === null) return null;
	const content = readFileContent(join(root, ref.path));
	const resolution = resolveSelector(ref.path, content, ref.selector);
	if (resolution.ok) return null;
	return issue("review-deps", path, {
		code: "unresolved-selector",
		message: `review dependency ${dependency} names nothing: ${resolution.reason}`,
		remediation: `Name a ${selectorKind(ref.path, ref.selector)} that exists in ${ref.path}, or drop the selector.`,
	});
}

function validateDependency(root: string, path: string, dependency: string): Issue[] {
	if (!isSafeReviewDependencyPath(dependency)) {
		return [issue("review-deps", path, `invalid review dependency path: ${dependency}`)];
	}
	try {
		const resolved = resolveReviewDependencies(root, [dependency]);
		const unresolved = unresolvedSelectorIssue(root, path, dependency);
		if (unresolved) return [unresolved];
		const broad = broadManifestIssue(path, dependency);
		if (!isReviewDependencyGlob(dependency) || resolved.targets.length > 0) {
			return broad ? [broad] : [];
		}
		return [
			issue("review-deps", path, {
				code: "review-dependency-glob-empty",
				message: `review dependency glob matches no files: ${dependency}`,
				severity: "warning",
			}),
		];
	} catch (error) {
		return [issue("review-deps", path, error instanceof Error ? error.message : String(error))];
	}
}

/** Document-to-document dependency edges between scanned documents. */
function documentGraph(root: string, dependencies: Map<string, string[]>): Map<string, string[]> {
	const graph = new Map<string, string[]>();
	for (const [document, declared] of dependencies) {
		let targets: string[] = [];
		try {
			targets = resolveReviewDependencies(root, declared).targets;
		} catch {
			// Invalid declarations are reported by validateDependency.
		}
		graph.set(
			document,
			targets.filter((target) => target !== document && dependencies.has(target)),
		);
	}
	return graph;
}

/** Tarjan's algorithm: strongly connected components, each in one linear pass. */
function stronglyConnected(graph: Map<string, string[]>): string[][] {
	let counter = 0;
	const index = new Map<string, number>();
	const low = new Map<string, number>();
	const onStack = new Set<string>();
	const stack: string[] = [];
	const components: string[][] = [];
	// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Tarjan's index/low-link bookkeeping reads best in one recursive step
	const connect = (node: string): void => {
		index.set(node, counter);
		low.set(node, counter);
		counter++;
		stack.push(node);
		onStack.add(node);
		for (const next of graph.get(node) ?? []) {
			if (!index.has(next)) {
				connect(next);
				low.set(node, Math.min(low.get(node) ?? 0, low.get(next) ?? 0));
			} else if (onStack.has(next)) {
				low.set(node, Math.min(low.get(node) ?? 0, index.get(next) ?? 0));
			}
		}
		if (low.get(node) !== index.get(node)) return;
		const component: string[] = [];
		let member: string | undefined;
		do {
			member = stack.pop();
			if (member === undefined) break;
			onStack.delete(member);
			component.push(member);
		} while (member !== node);
		components.push(component.sort((a, b) => a.localeCompare(b)));
	};
	for (const node of [...graph.keys()].sort()) if (!index.has(node)) connect(node);
	return components;
}

/**
 * Documents that depend on each other force a re-read of all of them whenever one is edited,
 * without any code having changed. One warning per group of mutually dependent documents.
 */
function cycleIssues(root: string, dependencies: Map<string, string[]>): Issue[] {
	return stronglyConnected(documentGraph(root, dependencies))
		.filter((component) => component.length > 1)
		.map((component) =>
			issue("review-deps", component[0] ?? "", {
				code: "review-dependency-cycle",
				message: `documents depend on each other: ${component.join(", ")}; editing one asks for a re-read of the others`,
				severity: "warning",
				remediation:
					"Remove the document-to-document review-deps and link the documents instead, unless one really restates the other's facts.",
			}),
		);
}

export const reviewDepsRule = { id: "review-deps", alwaysRun: true, run: runReviewDepsRule };
