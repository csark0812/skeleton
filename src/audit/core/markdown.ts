import GithubSlugger from "github-slugger";
import { remark } from "remark";
import remarkGfm from "remark-gfm";
import { visit } from "unist-util-visit";

type MarkdownRoot = ReturnType<typeof remark.prototype.parse>;
type HeadingInline = { type: string; value?: unknown };

export interface ExtractedLink {
	target: string;
	line?: number;
}

const MARKDOWN_LINK_RE = /(?<!!)\[([^\]]*)\]\(([^)]+)\)/g;
const REFERENCE_DEF_RE = /^\[([^\]]+)\]:\s+(\S+)/;
const HEADING_LINE_RE = /^(#{1,6})\s+(.+)$/;

const processor = remark().use(remarkGfm);

function lineFromOffset(content: string, offset: number | undefined): number | undefined {
	if (offset === undefined) return undefined;
	return content.slice(0, offset).split("\n").length;
}

export function extractLinksFromMarkdown(content: string, filePath: string): ExtractedLink[] {
	if (filePath.endsWith(".mdc")) {
		return extractLinksRegex(content);
	}

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
			links.push({
				target: node.url.trim(),
				line: lineFromOffset(content, node.position?.start.offset),
			});
		}
		if (node.type === "linkReference" && "identifier" in node) {
			const id = String(node.identifier).toLowerCase();
			const url = refDefs.get(id);
			if (url) {
				links.push({
					target: url.trim(),
					line: lineFromOffset(content, node.position?.start.offset),
				});
			}
		}
	});

	return links;
}

export function extractLinksRegex(content: string): ExtractedLink[] {
	const links: ExtractedLink[] = [];
	const lines = content.split("\n");
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i] ?? "";
		for (const match of line.matchAll(MARKDOWN_LINK_RE)) {
			const target = match[2]?.trim();
			if (target) links.push({ target, line: i + 1 });
		}
	}
	return links;
}

export function extractHeadingSlugs(content: string, filePath: string): Set<string> {
	if (filePath.endsWith(".mdc")) {
		return extractHeadingSlugsLineBased(content);
	}

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

function extractHeadingSlugsLineBased(content: string): Set<string> {
	const slugger = new GithubSlugger();
	const slugs = new Set<string>();
	for (const line of content.split("\n")) {
		const match = HEADING_LINE_RE.exec(line);
		if (match?.[2]) slugs.add(slugger.slug(match[2]));
	}
	return slugs;
}

export function slugifyAnchor(anchor: string): string {
	const slugger = new GithubSlugger();
	return slugger.slug(decodeURIComponent(anchor));
}
