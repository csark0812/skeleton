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
		const prev = idx > 0 ? content[idx - 1] : undefined;
		const next = content[end];
		// Do not treat `target.md#…` as a match inside `other-target.md#…` / `foo/target.md#…`.
		const leftOk = prev === undefined || /[^A-Za-z0-9_./-]/.test(prev);
		// Do not treat `#getting-started` as a match inside `#getting-started-guide`.
		const rightOk = next === undefined || /[^A-Za-z0-9_-]/.test(next);
		if (leftOk && rightOk) {
			out += content.slice(i, idx) + to;
			i = end;
		} else {
			out += content.slice(i, end);
			i = end;
		}
	}
	return out;
}

export function collectAnchorFixes(ctx: AuditContext): FixEdit[] {
	const editsByFile = new Map<string, { content: string; descriptions: string[] }>();

	for (const filePath of ctx.files) {
		const content = readFileContent(filePath);
		const links = extractLinksFromMarkdown(content, filePath);
		type Pending = {
			urlStart: number;
			urlEnd: number;
			from: string;
			to: string;
			description: string;
		};
		const pending: Pending[] = [];
		const relFile = relPath(filePath, ctx.root);

		for (const { target, line, urlStart, urlEnd } of links) {
			if (isExternalLink(target) && !target.startsWith("#")) continue;
			if (isPlaceholderLink(target)) continue;

			const anchor = target.includes("#") ? (target.split("#")[1]?.split("?")[0] ?? "") : "";
			if (!anchor) continue;

			const resolved = resolveLink(filePath, target);
			if (!existsSync(resolved)) continue;

			const targetContent = readFileSync(resolved, "utf8");
			const slugs = extractHeadingSlugs(targetContent, resolved);
			const anchorSlug = slugifyAnchor(anchor);
			if (slugs.has(anchorSlug)) continue;

			const match = findBestAnchorMatch(anchorSlug, slugs);
			if (!match) continue;

			const nextTarget = replaceAnchorInTarget(target, anchor, match.slug);
			if (nextTarget === target) continue;

			const lineLabel = line ? `${relFile}:${line}` : relFile;
			const description = `${lineLabel} #${anchor} → #${match.slug} (score ${match.score.toFixed(2)})`;

			if (
				urlStart !== undefined &&
				urlEnd !== undefined &&
				content.slice(urlStart, urlEnd) === target
			) {
				pending.push({ urlStart, urlEnd, from: target, to: nextTarget, description });
			}

			// Offset unknown (shouldn't happen for md/mdc extractors) — refuse whole-file rewrite.
		}

		if (pending.length === 0) continue;

		pending.sort((a, b) => b.urlStart - a.urlStart);
		let updated = content;
		const descriptions: string[] = [];
		for (const edit of pending) {
			if (updated.slice(edit.urlStart, edit.urlEnd) !== edit.from) continue;
			updated = updated.slice(0, edit.urlStart) + edit.to + updated.slice(edit.urlEnd);
			descriptions.push(edit.description);
		}
		if (updated === content || descriptions.length === 0) continue;
		editsByFile.set(filePath, { content: updated, descriptions });
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
