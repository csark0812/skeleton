import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { readFileContent, relPath } from "../core/collect.ts";
import type { AuditContext } from "../core/context.ts";
import type { FixEdit } from "../core/fix.ts";
import { extractHeadingSlugs, extractLinksFromMarkdown, slugifyAnchor } from "../core/markdown.ts";
import { isExternalLink, isPlaceholderLink } from "../core/shared.ts";
import { findBestAnchorMatch } from "./match-anchor.ts";

function resolveLink(sourceFile: string, target: string): string {
	const withoutAnchor = target.split("#")[0]?.split("?")[0] ?? "";
	if (!withoutAnchor) return sourceFile;
	return resolve(dirname(sourceFile), withoutAnchor);
}

function replaceAnchorInTarget(target: string, oldAnchor: string, newAnchor: string): string {
	const hashIndex = target.indexOf("#");
	if (hashIndex === -1) return target;
	const pathPart = target.slice(0, hashIndex);
	const fragment = target.slice(hashIndex + 1);
	const queryIndex = fragment.indexOf("?");
	const anchorPart = queryIndex === -1 ? fragment : fragment.slice(0, queryIndex);
	const queryPart = queryIndex === -1 ? "" : fragment.slice(queryIndex);
	if (anchorPart !== oldAnchor) return target;
	return `${pathPart}#${newAnchor}${queryPart}`;
}

type PendingAnchorEdit = {
	urlStart: number;
	urlEnd: number;
	from: string;
	to: string;
	description: string;
};

function boundaryOk(content: string, idx: number, end: number): boolean {
	const prev = idx > 0 ? content[idx - 1] : undefined;
	const next = content[end];
	const leftOk = prev === undefined || /[^A-Za-z0-9_./-]/.test(prev);
	const rightOk = next === undefined || /[^A-Za-z0-9_-]/.test(next);
	return leftOk && rightOk;
}

function replaceExactLinkTarget(content: string, from: string, to: string): string {
	let out = "";
	let i = 0;
	while (i < content.length) {
		const idx = content.indexOf(from, i);
		if (idx === -1) {
			out += content.slice(i);
			break;
		}
		const end = idx + from.length;
		if (boundaryOk(content, idx, end)) {
			out += content.slice(i, idx) + to;
			i = end;
		} else {
			out += content.slice(i, end);
			i = end;
		}
	}
	return out;
}

interface PendingAnchorInput {
	ctx: AuditContext;
	filePath: string;
	content: string;
	relFile: string;
	link: { target: string; line?: number; urlStart?: number; urlEnd?: number };
}

function anchorTargetReplacement(
	filePath: string,
	target: string,
): { nextTarget: string; match: { slug: string; score: number }; anchor: string } | null {
	if (isExternalLink(target) && !target.startsWith("#")) return null;
	if (isPlaceholderLink(target)) return null;

	const anchor = target.includes("#") ? (target.split("#")[1]?.split("?")[0] ?? "") : "";
	if (!anchor) return null;

	const resolved = resolveLink(filePath, target);
	if (!existsSync(resolved)) return null;

	const targetContent = readFileSync(resolved, "utf8");
	const slugs = extractHeadingSlugs(targetContent, resolved);
	const anchorSlug = slugifyAnchor(anchor);
	if (slugs.has(anchorSlug)) return null;

	const match = findBestAnchorMatch(anchorSlug, slugs);
	if (!match) return null;

	const nextTarget = replaceAnchorInTarget(target, anchor, match.slug);
	if (nextTarget === target) return null;
	return { nextTarget, match, anchor };
}

function pendingAnchorForLink(input: PendingAnchorInput): PendingAnchorEdit | null {
	const { filePath, content, relFile, link } = input;
	const { target, line, urlStart, urlEnd } = link;
	const replacement = anchorTargetReplacement(filePath, target);
	if (!replacement) return null;
	if (
		urlStart === undefined ||
		urlEnd === undefined ||
		content.slice(urlStart, urlEnd) !== target
	) {
		return null;
	}

	const lineLabel = line ? `${relFile}:${line}` : relFile;
	return {
		urlStart,
		urlEnd,
		from: target,
		to: replacement.nextTarget,
		description: `${lineLabel} #${replacement.anchor} → #${replacement.match.slug} (score ${replacement.match.score.toFixed(2)})`,
	};
}

function applyPendingEdits(
	content: string,
	pending: PendingAnchorEdit[],
): { content: string; descriptions: string[] } | null {
	const uniqueBySpan = new Map<string, PendingAnchorEdit>();
	for (const edit of pending) {
		uniqueBySpan.set(`${edit.urlStart}:${edit.urlEnd}:${edit.from}`, edit);
	}
	const uniquePending = [...uniqueBySpan.values()].sort((a, b) => b.urlStart - a.urlStart);
	let updated = content;
	const descriptions: string[] = [];
	for (const edit of uniquePending) {
		if (updated.slice(edit.urlStart, edit.urlEnd) !== edit.from) continue;
		updated = updated.slice(0, edit.urlStart) + edit.to + updated.slice(edit.urlEnd);
		descriptions.push(edit.description);
	}
	if (updated === content || descriptions.length === 0) return null;
	return { content: updated, descriptions };
}

function collectFileAnchorFixes(
	ctx: AuditContext,
	filePath: string,
): { content: string; descriptions: string[] } | null {
	const content = readFileContent(filePath);
	const links = extractLinksFromMarkdown(content, filePath);
	const relFile = relPath(filePath, ctx.root);
	const pending: PendingAnchorEdit[] = [];

	for (const link of links) {
		const edit = pendingAnchorForLink({ ctx, filePath, content, relFile, link });
		if (edit) pending.push(edit);
	}

	if (pending.length === 0) return null;
	return applyPendingEdits(content, pending);
}

export function collectAnchorFixes(ctx: AuditContext): FixEdit[] {
	const editsByFile = new Map<string, { content: string; descriptions: string[] }>();

	for (const filePath of ctx.files) {
		const result = collectFileAnchorFixes(ctx, filePath);
		if (result) editsByFile.set(filePath, result);
	}

	const edits: FixEdit[] = [];
	for (const [absPath, { content, descriptions }] of editsByFile) {
		edits.push({
			file: relPath(absPath, ctx.root),
			description: descriptions.join("; "),
			content,
		});
	}

	return edits;
}

/** Exported for unit tests. */
export { replaceExactLinkTarget };
