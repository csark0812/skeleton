import { createRequire } from "node:module";
import { extname } from "node:path";
import type * as TypeScript from "typescript";
import { markdownSections, slugifyAnchor } from "./markdown.ts";

/**
 * What the part after `#` names, decided by the target file: a dotted key path in JSON,
 * a heading in Markdown, a line range (`L3`, `L3-L9`) or a symbol in any other file.
 */
type SelectorKind = "json-key" | "heading" | "line" | "symbol";

type SelectorResolution = { ok: true } | { ok: false; reason: string };

interface SelectedRegion {
	text: string;
	/** False when the region is the whole file because the selector could not be narrowed. */
	narrowed: boolean;
}

const LINE_SELECTOR_RE = /^L(\d+)(?:-L(\d+))?$/;
const SYMBOL_SELECTOR_RE = /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*$/;
const SCRIPT_EXTENSIONS = new Set([".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"]);

export function selectorKind(target: string, selector: string): SelectorKind {
	if (/\.json$/i.test(target)) return "json-key";
	if (/\.mdx?$/i.test(target)) return "heading";
	if (LINE_SELECTOR_RE.test(selector)) return "line";
	return "symbol";
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** JSON with object keys sorted, so key order and formatting never change a digest. */
export function canonicalJson(value: unknown): string {
	if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
	if (isRecord(value)) {
		const keys = Object.keys(value).sort();
		return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
	}
	return JSON.stringify(value) ?? "null";
}

/** Walk a dotted key path through objects and, by numeric segment, arrays. */
export function selectedValue(root: unknown, selector: string): unknown {
	let current = root;
	for (const key of selector.split(".")) {
		if (Array.isArray(current) && /^\d+$/.test(key)) {
			current = current[Number(key)];
		} else if (isRecord(current) && key in current) {
			current = current[key];
		} else {
			return;
		}
	}
	return current;
}

function parsedJson(content: string): { ok: true; value: unknown } | { ok: false } {
	try {
		return { ok: true, value: JSON.parse(content) };
	} catch {
		return { ok: false };
	}
}

function escapeRegExp(text: string): string {
	return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function mentionsWord(content: string, word: string): boolean {
	return new RegExp(`(^|[^\\w$])${escapeRegExp(word)}(?![\\w$])`).test(content);
}

function lineRange(selector: string): { first: number; last: number } {
	const match = LINE_SELECTOR_RE.exec(selector);
	const first = Number(match?.[1]);
	return { first, last: match?.[2] ? Number(match[2]) : first };
}

function resolveJsonKey(content: string, selector: string): SelectorResolution {
	const parsed = parsedJson(content);
	if (!parsed.ok) return { ok: false, reason: "not valid JSON" };
	return selectedValue(parsed.value, selector) === undefined
		? { ok: false, reason: `no key ${selector}` }
		: { ok: true };
}

function resolveLines(content: string, selector: string): SelectorResolution {
	const { first, last } = lineRange(selector);
	const lineCount = content.split("\n").length;
	if (first < 1 || last < first) return { ok: false, reason: `invalid line range ${selector}` };
	return last > lineCount
		? { ok: false, reason: `line ${last} is past the end (${lineCount} lines)` }
		: { ok: true };
}

function resolveSymbol(content: string, selector: string): SelectorResolution {
	if (!SYMBOL_SELECTOR_RE.test(selector)) return { ok: false, reason: `not a symbol: ${selector}` };
	const missing = selector.split(".").find((part) => !mentionsWord(content, part));
	return missing === undefined ? { ok: true } : { ok: false, reason: `no symbol ${missing}` };
}

/** Does the selector name something in this target's content? */
export function resolveSelector(
	target: string,
	content: string,
	selector: string,
): SelectorResolution {
	switch (selectorKind(target, selector)) {
		case "json-key":
			return resolveJsonKey(content, selector);
		case "heading": {
			const slug = slugifyAnchor(selector);
			return markdownSections(content).some((section) => section.slug === slug)
				? { ok: true }
				: { ok: false, reason: `no heading #${slug}` };
		}
		case "line":
			return resolveLines(content, selector);
		case "symbol":
			return resolveSymbol(content, selector);
	}
}

let typescript: typeof TypeScript | null | undefined;

/** TypeScript 6 (a runtime dependency) parses JS and TS; loaded only when a symbol is narrowed. */
function loadTypeScript(): typeof TypeScript | null {
	if (typescript !== undefined) return typescript;
	try {
		typescript = createRequire(import.meta.url)("typescript") as typeof TypeScript;
	} catch {
		typescript = null;
	}
	return typescript;
}

function nameText(ts: typeof TypeScript, name: TypeScript.Node | undefined): string | undefined {
	if (!name) return;
	if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isPrivateIdentifier(name)) {
		return name.text;
	}
}

/** Named children one level below a node: top-level statements, members, or object properties. */
function namedChildren(ts: typeof TypeScript, node: TypeScript.Node): [string, TypeScript.Node][] {
	if (ts.isSourceFile(node) || ts.isModuleBlock(node)) {
		return node.statements.flatMap((statement) => namedStatement(ts, statement));
	}
	if (ts.isModuleDeclaration(node) && node.body) return namedChildren(ts, node.body);
	if (ts.isClassLike(node) || ts.isInterfaceDeclaration(node) || ts.isEnumDeclaration(node)) {
		return node.members.flatMap((member): [string, TypeScript.Node][] => {
			const name = nameText(ts, member.name);
			return name ? [[name, member]] : [];
		});
	}
	if (ts.isVariableDeclaration(node) && node.initializer) {
		return namedChildren(ts, node.initializer);
	}
	if (ts.isObjectLiteralExpression(node)) {
		return node.properties.flatMap((property): [string, TypeScript.Node][] => {
			const name = nameText(ts, property.name);
			return name ? [[name, property]] : [];
		});
	}
	return [];
}

function namedStatement(
	ts: typeof TypeScript,
	statement: TypeScript.Statement,
): [string, TypeScript.Node][] {
	if (ts.isVariableStatement(statement)) {
		return statement.declarationList.declarations.flatMap(
			(declaration): [string, TypeScript.Node][] => {
				const name = nameText(ts, declaration.name);
				return name ? [[name, declaration]] : [];
			},
		);
	}
	const name =
		"name" in statement ? nameText(ts, statement.name as TypeScript.Node | undefined) : undefined;
	return name ? [[name, statement]] : [];
}

/** Source text of the declaration a dotted symbol names, JSDoc included; null when not declared. */
function declarationText(target: string, content: string, selector: string): string | null {
	const ts = loadTypeScript();
	if (!ts) return null;
	const sourceFile = ts.createSourceFile(target, content, ts.ScriptTarget.Latest, true);
	let node: TypeScript.Node | undefined = sourceFile;
	for (const part of selector.split(".")) {
		node = node ? namedChildren(ts, node).find(([name]) => name === part)?.[1] : undefined;
	}
	if (!node || node === sourceFile) return null;
	const start = ts.isVariableDeclaration(node)
		? node.parent.parent.getStart(sourceFile, true)
		: node.getStart(sourceFile, true);
	return content.slice(start, node.getEnd());
}

/**
 * The text a review depends on, or null when the selector names nothing. A region is never
 * narrower than can be shown: a symbol outside JS/TS, or one TypeScript cannot find as a
 * declaration, is the whole file, so a change can only ask for more re-reads, never fewer.
 */
export function selectedRegion(
	target: string,
	content: string,
	selector: string,
): SelectedRegion | null {
	if (!resolveSelector(target, content, selector).ok) return null;
	switch (selectorKind(target, selector)) {
		case "json-key": {
			const parsed = parsedJson(content);
			const value = parsed.ok ? selectedValue(parsed.value, selector) : undefined;
			return { text: canonicalJson(value), narrowed: true };
		}
		case "heading": {
			const slug = slugifyAnchor(selector);
			const section = markdownSections(content).find((candidate) => candidate.slug === slug);
			return { text: section?.text ?? content, narrowed: section !== undefined };
		}
		case "line": {
			const { first, last } = lineRange(selector);
			return {
				text: content
					.split("\n")
					.slice(first - 1, last)
					.join("\n"),
				narrowed: true,
			};
		}
		case "symbol": {
			const declared = SCRIPT_EXTENSIONS.has(extname(target).toLowerCase())
				? declarationText(target, content, selector)
				: null;
			return declared === null
				? { text: content, narrowed: false }
				: { text: declared, narrowed: true };
		}
	}
}
