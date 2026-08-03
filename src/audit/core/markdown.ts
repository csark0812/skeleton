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

interface NodeSlice {
	content: string;
	nodeStart: number;
	nodeEnd: number;
	url: string;
}

const processor = remark().use(remarkGfm);

function lineFromOffset(content: string, offset: number | undefined): number | undefined {
	if (offset === undefined) return;
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

function skipWhitespace(slice: string, start: number): number {
	let i = start;
	while (i < slice.length) {
		const ch = slice[i];
		if (ch === undefined || !/\s/.test(ch)) break;
		i++;
	}
	return i;
}

function skipTitle(slice: string, start: number): number {
	if (start >= slice.length) return start;
	const open = slice[start];
	if (open !== '"' && open !== "'" && open !== "(") return start;
	const close = open === "(" ? ")" : open;
	let i = start + 1;
	while (i < slice.length && slice[i] !== close) i++;
	return i < slice.length ? i + 1 : i;
}

/**
 * True when `afterDest` is the end of an inline link destination (+ optional
 * title) that consumes through the closing `)` at the end of `slice`.
 * Rejects nested `](` in labels (linked images) and title-embedded `](url)`.
 */
function destinationConsumesToSliceEnd(slice: string, afterDest: number): boolean {
	if (afterDest >= slice.length) return false;
	if (slice[afterDest] === ")") return afterDest === slice.length - 1;

	const first = slice[afterDest];
	if (first === undefined || !/\s/.test(first)) return false;

	let i = skipWhitespace(slice, afterDest);
	if (i >= slice.length) return false;
	if (slice[i] === ")") return i === slice.length - 1;

	i = skipTitle(slice, i);
	i = skipWhitespace(slice, i);
	return i === slice.length - 1 && slice[i] === ")";
}

function spanForAngleUrl(
	slice: NodeSlice,
	after: number,
): { urlStart: number; urlEnd: number } | null {
	if (!slice.content.startsWith(`<${slice.url}>`, after)) return null;
	const afterDest = after + 2 + slice.url.length;
	if (!destinationConsumesToSliceEnd(slice.content, afterDest)) return null;
	const urlStart = slice.nodeStart + after + 1;
	return { urlStart, urlEnd: urlStart + slice.url.length };
}

function spanForBareUrl(
	slice: NodeSlice,
	after: number,
): { urlStart: number; urlEnd: number } | null {
	if (!slice.content.startsWith(slice.url, after)) return null;
	const next = slice.content[after + slice.url.length];
	if (!(next === ")" || (next !== undefined && /\s/.test(next)))) return null;
	if (!destinationConsumesToSliceEnd(slice.content, after + slice.url.length)) return null;
	const urlStart = slice.nodeStart + after;
	return { urlStart, urlEnd: urlStart + slice.url.length };
}

function tryLinkDestination(
	slice: NodeSlice,
	openParen: number,
): { urlStart: number; urlEnd: number } | null {
	const after = openParen + 2;
	return spanForAngleUrl(slice, after) ?? spanForBareUrl(slice, after);
}

/** Locate the URL span inside a markdown link/autolink node slice. */
function findUrlSpanInSlice(slice: NodeSlice): { urlStart: number; urlEnd: number } | undefined {
	const nodeSlice = slice.content.slice(slice.nodeStart, slice.nodeEnd);
	let searchFrom = 0;
	while (searchFrom < nodeSlice.length) {
		const openParen = nodeSlice.indexOf("](", searchFrom);
		if (openParen === -1) break;
		const span = tryLinkDestination(
			{ content: nodeSlice, nodeStart: slice.nodeStart, nodeEnd: slice.nodeEnd, url: slice.url },
			openParen,
		);
		if (span) return span;
		searchFrom = openParen + 1;
	}
	return matchAutolinkOrBare(nodeSlice, slice);
}

function matchAutolinkOrBare(
	nodeSlice: string,
	slice: NodeSlice,
): { urlStart: number; urlEnd: number } | undefined {
	const auto = `<${slice.url}>`;
	if (nodeSlice === auto) {
		return { urlStart: slice.nodeStart + 1, urlEnd: slice.nodeStart + 1 + slice.url.length };
	}
	if (nodeSlice === slice.url) {
		return { urlStart: slice.nodeStart, urlEnd: slice.nodeEnd };
	}
	const trimmed = nodeSlice.trim();
	if (trimmed === auto) {
		const lead = nodeSlice.indexOf(auto);
		if (lead !== -1) {
			return {
				urlStart: slice.nodeStart + lead + 1,
				urlEnd: slice.nodeStart + lead + 1 + slice.url.length,
			};
		}
	}
	if (trimmed === slice.url) {
		const lead = nodeSlice.indexOf(slice.url);
		if (lead !== -1) {
			return {
				urlStart: slice.nodeStart + lead,
				urlEnd: slice.nodeStart + lead + slice.url.length,
			};
		}
	}
}

type ReferenceDef = {
	url: string;
	urlStart: number;
	urlEnd: number;
	line: number;
};

/** Locate the destination token inside a remark `definition` node slice. */
function findUrlInDefinitionSlice(
	slice: NodeSlice,
): { urlStart: number; urlEnd: number } | undefined {
	const nodeSlice = slice.content.slice(slice.nodeStart, slice.nodeEnd);
	const labelEnd = nodeSlice.indexOf("]:");
	if (labelEnd === -1) return;
	let i = labelEnd + 2;
	while (i < nodeSlice.length && /\s/.test(nodeSlice[i] ?? "")) i++;
	if (nodeSlice.startsWith(`<${slice.url}>`, i)) {
		const urlStart = slice.nodeStart + i + 1;
		return { urlStart, urlEnd: urlStart + slice.url.length };
	}
	if (nodeSlice.startsWith(slice.url, i)) {
		const urlStart = slice.nodeStart + i;
		return { urlStart, urlEnd: urlStart + slice.url.length };
	}
}

function definitionFromNode(
	content: string,
	node: {
		identifier?: unknown;
		url?: unknown;
		position?: { start?: { offset?: number }; end?: { offset?: number } };
	},
	defs: Map<string, ReferenceDef>,
): void {
	if (!("identifier" in node && "url" in node)) return;
	const id = String(node.identifier).toLowerCase();
	if (defs.has(id)) return;
	const url = typeof node.url === "string" ? node.url : "";
	if (!url) return;
	const start = node.position?.start?.offset;
	const end = node.position?.end?.offset;
	if (start === undefined || end === undefined) return;
	const span = findUrlInDefinitionSlice({ content, nodeStart: start, nodeEnd: end, url });
	if (!span) return;
	defs.set(id, {
		url,
		urlStart: span.urlStart,
		urlEnd: span.urlEnd,
		line: lineFromOffset(content, start) ?? 1,
	});
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
		definitionFromNode(content, node, defs);
	});
	return defs;
}

function linkFromDirectNode(
	content: string,
	node: { url: string; position?: { start?: { offset?: number }; end?: { offset?: number } } },
): ExtractedLink {
	const target = node.url.trim();
	const start = node.position?.start?.offset;
	const end = node.position?.end?.offset;
	const span =
		start !== undefined && end !== undefined
			? findUrlSpanInSlice({ content, nodeStart: start, nodeEnd: end, url: target })
			: undefined;
	return {
		target,
		line: lineFromOffset(content, node.position?.start?.offset),
		urlStart: span?.urlStart,
		urlEnd: span?.urlEnd,
	};
}

function linkFromReference(id: string, refDefs: Map<string, ReferenceDef>): ExtractedLink | null {
	const def = refDefs.get(id);
	if (!def) return null;
	return {
		target: def.url.trim(),
		line: def.line,
		urlStart: def.urlStart,
		urlEnd: def.urlEnd,
	};
}

export function extractLinksFromMarkdown(content: string, _filePath?: string): ExtractedLink[] {
	const tree = processor.parse(content) as MarkdownRoot;
	const refDefs = collectReferenceDefinitions(content, tree);
	const links: ExtractedLink[] = [];

	visit(tree, (node) => {
		if (node.type === "link" && "url" in node && typeof node.url === "string") {
			links.push(
				linkFromDirectNode(
					content,
					node as {
						url: string;
						position?: { start?: { offset?: number }; end?: { offset?: number } };
					},
				),
			);
		}
		if (node.type === "linkReference" && "identifier" in node) {
			const refLink = linkFromReference(String(node.identifier).toLowerCase(), refDefs);
			if (refLink) links.push(refLink);
		}
	});

	return links;
}

type PhrasingNode = HeadingInline & { children?: PhrasingNode[] };

function textFromPhrasingNode(node: PhrasingNode): string {
	if (node.type === "text" || node.type === "inlineCode") {
		return "value" in node && node.value !== undefined ? String(node.value) : "";
	}
	return "";
}

/** Join remark phrasing (text, code, emphasis, strong, links, …) for GitHub-style heading slugs. */
function phrasingText(nodes: PhrasingNode[] | undefined): string {
	if (!nodes?.length) return "";
	let out = "";
	for (const node of nodes) {
		out += textFromPhrasingNode(node);
		if (node.children?.length) out += phrasingText(node.children);
	}
	return out;
}

export function extractHeadingSlugs(content: string, _filePath?: string): Set<string> {
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
