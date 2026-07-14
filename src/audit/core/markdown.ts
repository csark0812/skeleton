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

/** Locate the URL span inside a markdown link/autolink node slice. */
function findUrlSpanInSlice(
	content: string,
	nodeStart: number,
	nodeEnd: number,
	url: string,
): { urlStart: number; urlEnd: number } | undefined {
	const slice = content.slice(nodeStart, nodeEnd);
	const paren = `](${url})`;
	const parenIdx = slice.lastIndexOf(paren);
	if (parenIdx !== -1) {
		const urlStart = nodeStart + parenIdx + 2;
		return { urlStart, urlEnd: urlStart + url.length };
	}
	const auto = `<${url}>`;
	const autoIdx = slice.indexOf(auto);
	if (autoIdx !== -1) {
		const urlStart = nodeStart + autoIdx + 1;
		return { urlStart, urlEnd: urlStart + url.length };
	}
	if (slice === url) {
		return { urlStart: nodeStart, urlEnd: nodeEnd };
	}
	const trimmed = slice.trim();
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
		const trimmed = line.trimStart();
		if (trimmed.toLowerCase().startsWith(needle)) {
			const match = REFERENCE_DEF_RE.exec(line.trim());
			if (match?.[2] === url) {
				const urlInLine = line.lastIndexOf(url);
				if (urlInLine !== -1) {
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

export function extractHeadingSlugs(content: string, _filePath?: string): Set<string> {
	// Use remark for both .md and .mdc so headings inside fences are not valid targets.
	const slugger = new GithubSlugger();
	const slugs = new Set<string>();
	const tree = processor.parse(content) as MarkdownRoot;

	visit(tree, (node) => {
		if (node.type === "heading" && "children" in node) {
			const text = node.children
				.filter((c: HeadingInline) => c.type === "text" || c.type === "inlineCode")
				.map((c: HeadingInline) => ("value" in c ? String(c.value) : ""))
				.join("");
			if (text) slugs.add(slugger.slug(text));
		}
	});

	return slugs;
}

export function slugifyAnchor(anchor: string): string {
	const slugger = new GithubSlugger();
	return slugger.slug(decodeURIComponent(anchor));
}
