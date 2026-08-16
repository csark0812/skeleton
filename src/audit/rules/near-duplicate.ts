import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { AuditContext } from "../core/context.ts";
import { type Issue, issue } from "../core/report.ts";
import { matchesGlobScope, normalizeRelPath } from "../core/shared.ts";
import type { SsotFileEntry } from "../core/ssot-collect.ts";
import { contentTokens } from "../core/ssot-fit.ts";

const DEFAULT_THRESHOLD = 0.72;
const SHINGLE_N = 3;

function tokenize(text: string): string[] {
	return contentTokens(text);
}

function normalizeSummary(summary: string): string {
	return contentTokens(summary).join(" ");
}

function shingles(tokens: string[], n: number): Set<string> {
	const out = new Set<string>();
	if (tokens.length < n) {
		if (tokens.length > 0) out.add(tokens.join(" "));
		return out;
	}
	for (let i = 0; i <= tokens.length - n; i++) {
		out.add(tokens.slice(i, i + n).join(" "));
	}
	return out;
}

export function jaccard(a: Set<string>, b: Set<string>): number {
	if (a.size === 0 && b.size === 0) return 1;
	if (a.size === 0 || b.size === 0) return 0;
	let inter = 0;
	for (const x of a) {
		if (b.has(x)) inter++;
	}
	return inter / (a.size + b.size - inter);
}

function pairKey(a: string, b: string): string {
	return a < b ? `${a}::${b}` : `${b}::${a}`;
}

function ignoredPairSet(ctx: AuditContext): Set<string> {
	const pairs = ctx.config.docsLint?.ignorePairs ?? [];
	const set = new Set<string>();
	for (const pair of pairs) {
		if (!pair || pair.length < 2) continue;
		const a = normalizeRelPath(pair[0] ?? "");
		const b = normalizeRelPath(pair[1] ?? "");
		if (a && b) set.add(pairKey(a, b));
	}
	return set;
}

function isIgnoredGlob(rel: string, globs: string[]): boolean {
	return globs.some((g) => matchesGlobScope(rel, g));
}

function bodyWithoutSsotNoise(content: string): string {
	return content
		.replace(/<!--\s*source-of-truth:[\s\S]*?-->/gi, " ")
		.replace(/^\s*source-of-truth:\s*.+$/gim, " ")
		.replace(/^\s*\*\*Source of truth for\*\*\s*.+$/gim, " ");
}

function eligibleEntries(ctx: AuditContext): SsotFileEntry[] {
	const globs = ctx.config.docsLint?.ignoreGlobs ?? [];
	return ctx.ssotEntries.filter((e) => !isIgnoredGlob(e.path, globs));
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: intentional control flow
export function runNearDuplicateRule(ctx: AuditContext): Issue[] {
	const issues: Issue[] = [];
	const threshold = ctx.config.docsLint?.nearDuplicateThreshold ?? DEFAULT_THRESHOLD;
	const ignored = ignoredPairSet(ctx);
	const entries = eligibleEntries(ctx);

	const fingerprints = entries.map((e) => {
		const content = readFileSync(join(ctx.root, e.path), "utf8");
		const tokens = tokenize(bodyWithoutSsotNoise(content));
		return {
			path: e.path,
			summaryKey: normalizeSummary(e.summary),
			set: shingles(tokens, SHINGLE_N),
		};
	});

	for (let i = 0; i < fingerprints.length; i++) {
		for (let j = i + 1; j < fingerprints.length; j++) {
			const a = fingerprints[i];
			const b = fingerprints[j];
			if (!(a && b)) continue;
			if (ignored.has(pairKey(a.path, b.path))) continue;

			const score = jaccard(a.set, b.set);
			if (score >= threshold) {
				issues.push(
					issue("near-duplicate", a.path, {
						message: `near-duplicate of ${b.path} (shingle Jaccard ${score.toFixed(2)} ≥ ${threshold})`,
						severity: "warning",
					}),
				);
			}

			if (a.summaryKey && a.summaryKey === b.summaryKey) {
				issues.push(
					issue("near-duplicate", a.path, {
						message: `duplicate source-of-truth summary also used by ${b.path}`,
						severity: "warning",
					}),
				);
			}
		}
	}

	return issues;
}

export const nearDuplicateRule = { id: "near-duplicate", run: runNearDuplicateRule };
