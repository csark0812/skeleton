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

const processor = remark().use(remarkGfm);

function lineFromOffset(content: string, offset: number | undefined): number | undefined {
	if (offset === undefined) return undefined;
	return content.slice(0, offset).split("\n").length;
}

/**
 * Strip leading YAML frontmatter so a closing `---` is not parsed as a setext
 * underline (which yields false heading slugs like `title-getting-started`).
 */
export function stripYamlFrontmatter(content: string): string {
	const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(content);
	if (match) return content.slice(match[0].length);
	const eof = /^---\r?\n([\s\S]*?)\r?\n---\s*$/.exec(content);
	if (eof) return "";
	return content;
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

type ReferenceDef = {
	url: string;
	urlStart: number;
	urlEnd: number;
	line: number;
};

/** Locate the destination token inside a remark `definition` node slice. */
function findUrlInDefinitionSlice(
	content: string,
	nodeStart: number,
	nodeEnd: number,
	url: string,
): { urlStart: number; urlEnd: number } | undefined {
	const slice = content.slice(nodeStart, nodeEnd);
	const labelEnd = slice.indexOf("]:");
	if (labelEnd === -1) return undefined;
	let i = labelEnd + 2;
	while (i < slice.length && /\s/.test(slice[i] ?? "")) i++;
	if (slice.startsWith(`<${url}>`, i)) {
		const urlStart = nodeStart + i + 1;
		return { urlStart, urlEnd: urlStart + url.length };
	}
	if (slice.startsWith(url, i)) {
		const urlStart = nodeStart + i;
		return { urlStart, urlEnd: urlStart + url.length };
	}
	return undefined;
}

/**
 * Structural reference definitions only (remark `definition` nodes).
 * Skips fenced/indented code and HTML comments; first definition wins.
 */
function collectReferenceDefinitions(
	content: string,
	tree: MarkdownRoot,
): Map<string, ReferenceDef> {
	const defs = new Map<string, ReferenceDef>();
	visit(tree, (node) => {
		if (node.type !== "definition") return;
		if (!("identifier" in node) || !("url" in node)) return;
		const id = String(node.identifier).toLowerCase();
		if (defs.has(id)) return;
		const url = typeof node.url === "string" ? node.url : "";
		if (!url) return;
		const start = node.position?.start.offset;
		const end = node.position?.end.offset;
		if (start === undefined || end === undefined) return;
		const span = findUrlInDefinitionSlice(content, start, end, url);
		if (!span) return;
		defs.set(id, {
			url,
			urlStart: span.urlStart,
			urlEnd: span.urlEnd,
			line: lineFromOffset(content, start) ?? 1,
		});
	});
	return defs;
}

export function extractLinksFromMarkdown(content: string, _filePath?: string): ExtractedLink[] {
	// Use remark for both .md and .mdc so fenced/inline code is not treated as links.
	const tree = processor.parse(content) as MarkdownRoot;
	const refDefs = collectReferenceDefinitions(content, tree);
	const links: ExtractedLink[] = [];

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
			const def = refDefs.get(id);
			if (def) {
				links.push({
					target: def.url.trim(),
					line: def.line,
					urlStart: def.urlStart,
					urlEnd: def.urlEnd,
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
	// Strip YAML frontmatter first — closing `---` is otherwise a setext underline.
	const body = stripYamlFrontmatter(content);
	const slugger = new GithubSlugger();
	const slugs = new Set<string>();
	const tree = processor.parse(body) as MarkdownRoot;

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
