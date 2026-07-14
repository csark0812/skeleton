import GithubSlugger from "github-slugger";
import { remark } from "remark";
import remarkGfm from "remark-gfm";
import { visit } from "unist-util-visit";

type MarkdownRoot = ReturnType<typeof remark.prototype.parse>;
type HeadingInline = { type: string; value?: unknown };

export interface ExtractedLink {
	target: string;
	line?: number;
	/** Inclusive start offset of the URL in the source (when known). */
	urlStart?: number;
	/** Exclusive end offset of the URL in the source (when known). */
	urlEnd?: number;
}

const REFERENCE_DEF_RE = /^\[([^\]]+)\]:\s+(\S+)/;

const processor = remark().use(remarkGfm);

function lineFromOffset(content: string, offset: number | undefined): number | undefined {
	if (offset === undefined) return undefined;
	return content.slice(0, offset).split("\n").length;
}

/**
 * True when `afterDest` is the end of an inline link destination (+ optional
 * title) that consumes through the closing `)` at the end of `slice`.
 * Rejects nested `](` in labels (linked images) and title-embedded `](url)`.
 */
function destinationConsumesToSliceEnd(slice: string, afterDest: number): boolean {
	let i = afterDest;
	if (i >= slice.length) return false;
	if (slice[i] === ")") {
		return i === slice.length - 1;
	}
	if (!/\s/.test(slice[i]!)) return false;
	while (i < slice.length && /\s/.test(slice[i]!)) i++;
	if (i >= slice.length) return false;
	if (slice[i] === ")") {
		return i === slice.length - 1;
	}
	const open = slice[i];
	if (open !== '"' && open !== "'" && open !== "(") return false;
	const close = open === "(" ? ")" : open;
	i++;
	while (i < slice.length && slice[i] !== close) i++;
	if (i >= slice.length) return false;
	i++;
	while (i < slice.length && /\s/.test(slice[i]!)) i++;
	return i === slice.length - 1 && slice[i] === ")";
}

/** Locate the URL span inside a markdown link/autolink node slice. */
function findUrlSpanInSlice(
	content: string,
	nodeStart: number,
	nodeEnd: number,
	url: string,
): { urlStart: number; urlEnd: number } | undefined {
	const slice = content.slice(nodeStart, nodeEnd);
	// Bind the link destination — not the first `](` (linked images put a
	// destination in the label) and not the last (titles may embed `](url)`).
	// Prefer the candidate whose dest (+ optional title) consumes to slice end.
	let searchFrom = 0;
	while (searchFrom < slice.length) {
		const openParen = slice.indexOf("](", searchFrom);
		if (openParen === -1) break;
		const after = openParen + 2;
		if (slice.startsWith(`<${url}>`, after)) {
			const afterDest = after + 2 + url.length;
			if (destinationConsumesToSliceEnd(slice, afterDest)) {
				const urlStart = nodeStart + after + 1;
				return { urlStart, urlEnd: urlStart + url.length };
			}
		} else if (slice.startsWith(url, after)) {
			const next = slice[after + url.length];
			if (next === ")" || (next !== undefined && /\s/.test(next))) {
				if (destinationConsumesToSliceEnd(slice, after + url.length)) {
					const urlStart = nodeStart + after;
					return { urlStart, urlEnd: urlStart + url.length };
				}
			}
		}
		searchFrom = openParen + 1;
	}
	// Autolink / bare URL nodes — whole slice only (never search the label).
	const auto = `<${url}>`;
	if (slice === auto) {
		return { urlStart: nodeStart + 1, urlEnd: nodeStart + 1 + url.length };
	}
	if (slice === url) {
		return { urlStart: nodeStart, urlEnd: nodeEnd };
	}
	const trimmed = slice.trim();
	if (trimmed === auto) {
		const lead = slice.indexOf(auto);
		if (lead !== -1) {
			return { urlStart: nodeStart + lead + 1, urlEnd: nodeStart + lead + 1 + url.length };
		}
	}
	if (trimmed === url) {
		const lead = slice.indexOf(url);
		if (lead !== -1) {
			return { urlStart: nodeStart + lead, urlEnd: nodeStart + lead + url.length };
		}
	}
	return undefined;
}

function findReferenceDefUrlSpan(
	content: string,
	identifier: string,
	url: string,
): { urlStart: number; urlEnd: number; line: number } | undefined {
	const lines = content.split("\n");
	const needle = `[${identifier}]:`.toLowerCase();
	let offset = 0;
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i] ?? "";
		const leadWs = line.length - line.trimStart().length;
		const trimmed = line.trimStart();
		if (trimmed.toLowerCase().startsWith(needle)) {
			const match = REFERENCE_DEF_RE.exec(trimmed);
			if (match?.[2] === url) {
				// Bind the destination token immediately after `[id]:`, not a later title copy.
				const afterLabel = trimmed.slice(needle.length);
				const urlOffsetInTrimmed = needle.length + afterLabel.search(/\S/);
				const urlInLine = leadWs + urlOffsetInTrimmed;
				if (line.slice(urlInLine, urlInLine + url.length) === url) {
					return {
						urlStart: offset + urlInLine,
						urlEnd: offset + urlInLine + url.length,
						line: i + 1,
					};
				}
			}
		}
		offset += line.length + 1;
	}
	return undefined;
}

export function extractLinksFromMarkdown(content: string, _filePath?: string): ExtractedLink[] {
	// Use remark for both .md and .mdc so fenced/inline code is not treated as links.
	const tree = processor.parse(content) as MarkdownRoot;
	const refDefs = new Map<string, string>();
	const links: ExtractedLink[] = [];

	for (const line of content.split("\n")) {
		const match = REFERENCE_DEF_RE.exec(line.trim());
		if (match?.[1] && match[2]) {
			refDefs.set(match[1].toLowerCase(), match[2]);
		}
	}

	visit(tree, (node) => {
		if (node.type === "link" && "url" in node && typeof node.url === "string") {
			const target = node.url.trim();
			const start = node.position?.start.offset;
			const end = node.position?.end.offset;
			const span =
				start !== undefined && end !== undefined
					? findUrlSpanInSlice(content, start, end, target)
					: undefined;
			links.push({
				target,
				line: lineFromOffset(content, node.position?.start.offset),
				urlStart: span?.urlStart,
				urlEnd: span?.urlEnd,
			});
		}
		if (node.type === "linkReference" && "identifier" in node) {
			const id = String(node.identifier).toLowerCase();
			const url = refDefs.get(id);
			if (url) {
				const span = findReferenceDefUrlSpan(content, String(node.identifier), url);
				links.push({
					target: url.trim(),
					line: span?.line ?? lineFromOffset(content, node.position?.start.offset),
					urlStart: span?.urlStart,
					urlEnd: span?.urlEnd,
				});
			}
		}
	});

	return links;
}

type PhrasingNode = HeadingInline & { children?: PhrasingNode[] };

/** Join remark phrasing (text, code, emphasis, strong, links, …) for GitHub-style heading slugs. */
function phrasingText(nodes: PhrasingNode[] | undefined): string {
	if (!nodes?.length) return "";
	let out = "";
	for (const node of nodes) {
		if (node.type === "text" || node.type === "inlineCode") {
			out += "value" in node && node.value !== undefined ? String(node.value) : "";
			continue;
		}
		if (node.children?.length) {
			out += phrasingText(node.children);
		}
	}
	return out;
}

export function extractHeadingSlugs(content: string, _filePath?: string): Set<string> {
	// Use remark for both .md and .mdc so headings inside fences are not valid targets.
	const slugger = new GithubSlugger();
	const slugs = new Set<string>();
	const tree = processor.parse(content) as MarkdownRoot;

	visit(tree, (node) => {
		if (node.type === "heading" && "children" in node) {
			const text = phrasingText(node.children as PhrasingNode[]);
			if (text) slugs.add(slugger.slug(text));
		}
	});

	return slugs;
}

export function slugifyAnchor(anchor: string): string {
	const slugger = new GithubSlugger();
	return slugger.slug(decodeURIComponent(anchor));
}
