/**
 * Docs↔code surface fit (no LLM): opt-in markers, public-name coverage, identifier overlap.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { contentTokens, uniqueContentTokens } from "./ssot-fit.ts";

export const DEFAULT_CODE_FIT_OVERLAP_MIN = 0.03;
export const DEFAULT_CODE_FIT_SURFACE_CAP = 25;

const CODE_FIT_RE = /<!--\s*code-fit:\s*([^>]*?)-->/gi;

export interface CodeFitMarker {
	targets: string[];
	surface: string[] | null;
	raw: string;
}

export interface CodeFitOptions {
	overlapMin?: number;
	surfaceCap?: number;
	root: string;
}

export interface CodeFitIssue {
	path: string;
	message: string;
	link?: string;
}

/** Parse all code-fit HTML comment markers in a markdown body (fences + inline code stripped). */
export function parseCodeFitMarkers(content: string): CodeFitMarker[] {
	const withoutCode = content.replace(/```[\s\S]*?```/g, "\n").replace(/`[^`\n]+`/g, " ");
	const out: CodeFitMarker[] = [];
	for (const match of withoutCode.matchAll(CODE_FIT_RE)) {
		const body = (match[1] ?? "").trim();
		const parsed = parseMarkerBody(body);
		if (parsed) out.push(parsed);
	}
	return out;
}

function parseMarkerBody(body: string): CodeFitMarker | null {
	const targetsMatch = /\btargets\s*=\s*([^\s]+)/i.exec(body);
	if (!targetsMatch?.[1]) return null;
	const targets = targetsMatch[1]
		.split(",")
		.map((t) => t.trim())
		.filter(Boolean);
	if (targets.length === 0) return null;

	const surfaceMatch = /\bsurface\s*=\s*([^\s]+)/i.exec(body);
	const surface = surfaceMatch?.[1]
		? surfaceMatch[1]
				.split(",")
				.map((s) => s.trim())
				.filter(Boolean)
		: null;

	return { targets, surface, raw: body };
}

/** Strip // and /* *\/ comments and string literals for identifier harvest. */
export function stripCodeNoise(source: string): string {
	return source
		.replace(/\/\*[\s\S]*?\*\//g, "\n")
		.replace(/\/\/[^\n]*/g, "\n")
		.replace(/`(?:\\.|[^`\\])*`/g, " ")
		.replace(/'(?:\\.|[^'\\])*'/g, " ")
		.replace(/"(?:\\.|[^"\\])*"/g, " ");
}

/** Auto-extract public-ish names: export forms + case "…" dispatch labels. */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: many export grammar forms
export function extractPublicSurface(source: string): string[] {
	const names = new Set<string>();

	for (const m of source.matchAll(/\bcase\s+["']([^"']+)["']\s*:/g)) {
		if (m[1]) names.add(m[1]);
	}

	for (const m of source.matchAll(
		/\bexport\s+(?:async\s+)?(?:function|class|const|let|var|type|interface|enum)\s+([A-Za-z_$][\w$]*)/g,
	)) {
		if (m[1]) names.add(m[1]);
	}

	for (const m of source.matchAll(
		/\bexport\s+default\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/g,
	)) {
		if (m[1]) names.add(m[1]);
	}

	for (const m of source.matchAll(/\bexport\s+default\s+class\s+([A-Za-z_$][\w$]*)/g)) {
		if (m[1]) names.add(m[1]);
	}

	collectExportListNames(source, names);
	return [...names].sort();
}

function collectExportListNames(source: string, names: Set<string>): void {
	for (const m of source.matchAll(/\bexport\s*\{([^}]+)\}/g)) {
		const inner = m[1] ?? "";
		for (const part of inner.split(",")) {
			addExportListPart(part.trim(), names);
		}
	}
}

function addExportListPart(cleaned: string, names: Set<string>): void {
	if (!cleaned || cleaned === "type" || cleaned === "typeof") return;
	const asMatch = /^([\w$]+)\s+as\s+([\w$]+)$/.exec(cleaned);
	if (asMatch?.[2]) {
		names.add(asMatch[2]);
		return;
	}
	const typeAs = /^type\s+([\w$]+)(?:\s+as\s+([\w$]+))?$/.exec(cleaned);
	if (typeAs?.[1]) {
		names.add(typeAs[2] ?? typeAs[1]);
		return;
	}
	const id = /^([\w$]+)$/.exec(cleaned);
	if (id?.[1]) names.add(id[1]);
}

/** Identifier tokens from source (for lexical overlap). */
export function codeIdentifiers(source: string): string[] {
	const stripped = stripCodeNoise(source);
	return uniqueContentTokens(stripped.replace(/[^A-Za-z0-9_$]+/g, " ").replace(/_/g, " "));
}

/**
 * Fraction of unique doc content tokens that also appear as identifiers in the
 * code file (doc grounded in module vocabulary). Separate from name coverage.
 */
export function identifierOverlap(docContent: string, codeSource: string): number {
	const codeIds = new Set(codeIdentifiers(codeSource));
	if (codeIds.size === 0) return 1;
	const docToks = uniqueContentTokens(docContent);
	if (docToks.length === 0) return 0;
	let hit = 0;
	for (const t of docToks) {
		if (codeIds.has(t)) hit++;
	}
	return hit / docToks.length;
}

function nameInDoc(name: string, docContent: string): boolean {
	const docToks = new Set(contentTokens(docContent));
	const parts = uniqueContentTokens(name.replace(/_/g, " "));
	if (parts.length === 0) {
		return docToks.has(name.toLowerCase());
	}
	// camelCase → single lower token via contentTokens on the raw name
	const asToken = contentTokens(name);
	if (asToken.some((t) => docToks.has(t))) return true;
	return parts.every((p) => docToks.has(p));
}

function nameExistsInTarget(name: string, autoSurface: string[], source: string): boolean {
	if (autoSurface.includes(name)) return true;
	const ids = new Set(extractPublicSurface(source));
	if (ids.has(name)) return true;
	// Allow surface= of identifiers present as word tokens in source
	const re = new RegExp(`\\b${escapeRegExp(name)}\\b`);
	return re.test(source);
}

function escapeRegExp(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

interface EvaluateTargetInput {
	docPath: string;
	docContent: string;
	target: string;
	surfaceOverride: string[] | null;
	options: CodeFitOptions;
}

function pushCoverageGaps(
	issues: CodeFitIssue[],
	input: EvaluateTargetInput,
	effective: string[],
): void {
	if (effective.length === 0) return;
	const missing = effective.filter((n) => !nameInDoc(n, input.docContent));
	if (missing.length === 0) return;
	issues.push({
		path: input.docPath,
		message: `code-fit coverage: doc does not mention ${missing.map((m) => `"${m}"`).join(", ")} (from ${input.target})`,
		link: input.target,
	});
}

function pushLexicalGap(issues: CodeFitIssue[], input: EvaluateTargetInput, source: string): void {
	const overlapMin = input.options.overlapMin ?? DEFAULT_CODE_FIT_OVERLAP_MIN;
	const overlap = identifierOverlap(input.docContent, source);
	if (overlap + 1e-9 >= overlapMin) return;
	issues.push({
		path: input.docPath,
		message: `code-fit lexical overlap ${(overlap * 100).toFixed(0)}% < ${(overlapMin * 100).toFixed(0)}% vs ${input.target}`,
		link: input.target,
	});
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: staged early-returns for missing/cap/surface
function evaluateTarget(input: EvaluateTargetInput): CodeFitIssue[] {
	const issues: CodeFitIssue[] = [];
	const abs = join(input.options.root, input.target);
	if (!existsSync(abs)) {
		issues.push({
			path: input.docPath,
			message: `code-fit target missing: ${input.target}`,
			link: input.target,
		});
		return issues;
	}

	const source = readFileSync(abs, "utf8");
	const auto = extractPublicSurface(source);
	const cap = input.options.surfaceCap ?? DEFAULT_CODE_FIT_SURFACE_CAP;

	if (input.surfaceOverride === null && auto.length > cap) {
		issues.push({
			path: input.docPath,
			message: `code-fit auto-surface has ${auto.length} names (cap ${cap}); add surface=… to the marker for ${input.target}`,
			link: input.target,
		});
		return issues;
	}

	if (input.surfaceOverride !== null) {
		for (const name of input.surfaceOverride) {
			if (!nameExistsInTarget(name, auto, source)) {
				issues.push({
					path: input.docPath,
					message: `code-fit surface name "${name}" not found in ${input.target}`,
					link: input.target,
				});
			}
		}
	}

	const effective = input.surfaceOverride !== null ? input.surfaceOverride : auto;
	pushCoverageGaps(issues, input, effective);
	pushLexicalGap(issues, input, source);
	return issues;
}

/** Evaluate one markdown doc's code-fit markers. */
export function evaluateCodeFitDoc(
	docPath: string,
	docContent: string,
	options: CodeFitOptions,
): CodeFitIssue[] {
	const markers = parseCodeFitMarkers(docContent);
	if (markers.length === 0) return [];

	const issues: CodeFitIssue[] = [];
	for (const marker of markers) {
		if (marker.targets.length === 0) {
			issues.push({
				path: docPath,
				message: "code-fit marker missing targets=",
			});
			continue;
		}
		for (const target of marker.targets) {
			issues.push(
				...evaluateTarget({
					docPath,
					docContent,
					target,
					surfaceOverride: marker.surface,
					options,
				}),
			);
		}
	}
	return issues;
}
