/**
 * Lexical SSOT↔evidence fit (no LLM).
 * Conservative stemming, H1/lead/body evidence, overlap, phrase-as-explanation, better-match.
 */

export const DEFAULT_SSOT_OVERLAP_MIN = 0.35;
export const DEFAULT_BETTER_MATCH_MARGIN = 0.15;

const STOP = new Set([
	"a",
	"an",
	"the",
	"and",
	"or",
	"of",
	"for",
	"to",
	"in",
	"on",
	"with",
	"this",
	"that",
	"is",
	"are",
	"be",
	"as",
	"by",
	"from",
	"at",
	"it",
	"its",
]);

/** Words that must not lose a trailing s (conservative under-stemming). */
const STEM_BLOCKLIST = new Set([
	"business",
	"analysis",
	"status",
	"process",
	"access",
	"address",
	"series",
	"species",
	"news",
	"means",
	"cross",
	"class",
	"glass",
	"less",
	"success",
	"progress",
	"express",
	"discuss",
	"focus",
	"bonus",
	"basis",
	"crisis",
	"thesis",
	"atlas",
	"canvas",
	"campus",
	"virus",
	"bus",
	"gas",
	"plus",
	"alias",
	"bias",
	"circus",
	"consensus",
	"census",
]);

export function lightStem(token: string): string {
	if (token.length < 4) return token;
	if (STEM_BLOCKLIST.has(token)) return token;
	// ies → y (tiers is not ies; parties → party)
	if (token.endsWith("ies") && token.length > 4) {
		return `${token.slice(0, -3)}y`;
	}
	// Safe plurals: ...ches/shes/sses/xes → drop es; else drop trailing s (not ss)
	if (
		token.endsWith("sses") ||
		token.endsWith("ches") ||
		token.endsWith("shes") ||
		token.endsWith("xes")
	) {
		return token.slice(0, -2);
	}
	if (
		token.endsWith("s") &&
		!token.endsWith("ss") &&
		!token.endsWith("us") &&
		!token.endsWith("is")
	) {
		return token.slice(0, -1);
	}
	return token;
}

export function contentTokens(text: string): string[] {
	return text
		.toLowerCase()
		.replace(/[^a-z0-9\s]/g, " ")
		.split(/\s+/)
		.filter((t) => t.length > 1 && !STOP.has(t))
		.map(lightStem);
}

export function uniqueContentTokens(text: string): string[] {
	return [...new Set(contentTokens(text))];
}

function stripCode(content: string): string {
	return content.replace(/```[\s\S]*?```/g, "\n").replace(/`[^`\n]+`/g, " ");
}

function stripSsotAndMeta(content: string): string {
	return content
		.replace(/<!--\s*source-of-truth:[\s\S]*?-->/gi, "\n")
		.replace(/^\s*source-of-truth:\s*.+$/gim, "\n")
		.replace(/^\s*\*\*Source of truth for\*\*\s*.+$/gim, "\n")
		.replace(/<!--\s*doc-meta:[\s\S]*?-->/gi, "\n");
}

/** First ATX H1 text, if any. */
export function extractH1(content: string): string {
	const prose = stripCode(content);
	const m = /^#\s+(.+)$/m.exec(prose);
	return m?.[1]?.trim() ?? "";
}

/** First non-empty prose paragraph after stripping SSOT/meta/code. */
export function extractLeadParagraph(content: string): string {
	const prose = stripSsotAndMeta(stripCode(content));
	const lines = prose.split(/\n/);
	const chunks: string[] = [];
	let buf: string[] = [];
	const flush = () => {
		const t = buf.join(" ").trim();
		if (t) chunks.push(t);
		buf = [];
	};
	for (const line of lines) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith("#")) {
			flush();
			continue;
		}
		if (/^[-*|]/.test(trimmed) && chunks.length === 0 && buf.length === 0) {
			// skip tables/lists until we have a paragraph — still allow as lead if nothing else
			buf.push(trimmed.replace(/^[-*|]+\s*/, ""));
			continue;
		}
		buf.push(trimmed);
	}
	flush();
	return chunks[0] ?? "";
}

export function buildEvidenceText(content: string): string {
	const h1 = extractH1(content);
	const lead = extractLeadParagraph(content);
	const body = stripSsotAndMeta(stripCode(content));
	return [h1, lead, body].filter(Boolean).join("\n\n");
}

export function ssotEvidenceOverlap(summary: string, evidence: string): number {
	const st = uniqueContentTokens(summary);
	if (st.length === 0) return 0;
	const ev = new Set(contentTokens(evidence));
	let hit = 0;
	for (const t of st) {
		if (ev.has(t)) hit++;
	}
	return hit / st.length;
}

/** Longest contentful n-gram from summary (prefer 3, else 2). */
export function longestSummaryPhrase(summary: string): string[] | null {
	const toks = contentTokens(summary);
	if (toks.length >= 3) return toks.slice(0, 3);
	if (toks.length >= 2) return toks.slice(0, 2);
	return null;
}

export function evidenceHasPhrase(evidence: string, phrase: string[]): boolean {
	if (phrase.length === 0) return true;
	const ev = contentTokens(evidence);
	const needle = phrase.join(" ");
	for (let i = 0; i <= ev.length - phrase.length; i++) {
		if (ev.slice(i, i + phrase.length).join(" ") === needle) return true;
	}
	return false;
}

export interface FitOptions {
	overlapMin?: number;
	betterMatchMargin?: number;
	phraseCheck?: boolean;
}

export interface FitFile {
	path: string;
	summary: string;
	content: string;
}

export type FitIssueKind = "short" | "weak" | "better-match";

export interface FitIssue {
	kind: FitIssueKind;
	path: string;
	message: string;
	otherPath?: string;
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: intentional control flow
export function evaluateSsotFit(files: FitFile[], options: FitOptions = {}): FitIssue[] {
	const overlapMin = options.overlapMin ?? DEFAULT_SSOT_OVERLAP_MIN;
	const margin = options.betterMatchMargin ?? DEFAULT_BETTER_MATCH_MARGIN;
	const phraseCheck = options.phraseCheck !== false;

	const prepared = files.map((f) => {
		const evidence = buildEvidenceText(f.content);
		const overlap = ssotEvidenceOverlap(f.summary, evidence);
		const summaryToks = uniqueContentTokens(f.summary);
		return { ...f, evidence, overlap, summaryToks };
	});

	const issues: FitIssue[] = [];

	for (const row of prepared) {
		if (row.summaryToks.length < 2) {
			issues.push({
				kind: "short",
				path: row.path,
				message: `source-of-truth summary too short to verify against body ("${row.summary}")`,
			});
			continue;
		}

		if (row.overlap < overlapMin) {
			let message = `source-of-truth summary weakly matches this paper (token overlap ${row.overlap.toFixed(2)} < ${overlapMin})`;
			if (phraseCheck) {
				const phrase = longestSummaryPhrase(row.summary);
				if (phrase && !evidenceHasPhrase(row.evidence, phrase)) {
					message += ` — key phrase "${phrase.join(" ")}" not found in H1/lead/body`;
				}
			}
			issues.push({ kind: "weak", path: row.path, message });

			let best: { path: string; overlap: number } | null = null;
			for (const other of prepared) {
				if (other.path === row.path) continue;
				const cross = ssotEvidenceOverlap(row.summary, other.evidence);
				if (cross < overlapMin) continue;
				if (cross < row.overlap + margin) continue;
				if (!best || cross > best.overlap) best = { path: other.path, overlap: cross };
			}
			if (best) {
				issues.push({
					kind: "better-match",
					path: row.path,
					otherPath: best.path,
					message:
						`source-of-truth fits ${best.path} better (overlap ${best.overlap.toFixed(2)} vs own ${row.overlap.toFixed(2)}). ` +
						`Try: (1) rewrite this SSOT to match this paper, (2) move/fix the marker onto ${best.path}, ` +
						`or (3) if these pages are really one topic, consider combining them`,
				});
			}
		}
	}

	return issues;
}

/** @deprecated Prefer ssotEvidenceOverlap — kept for callers that pass raw body. */
export function ssotBodyOverlap(summary: string, body: string): number {
	return ssotEvidenceOverlap(summary, body);
}
