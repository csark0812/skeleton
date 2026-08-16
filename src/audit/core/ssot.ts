export type SsotForm = "comment" | "visible" | "legacy";

export interface SsotEntry {
	summary: string;
	form: SsotForm;
}

export type SsotParseResult =
	| { status: "ok"; entry: SsotEntry }
	| { status: "none" }
	| { status: "dual"; forms: SsotForm[] }
	| { status: "malformed"; detail: string };

const SSOT_COMMENT_RE = /<!--\s*source-of-truth:\s*([\s\S]*?)\s*-->/gi;
/** Horizontal whitespace only — `\s` would let `^…$` rewrite eat blank lines around the marker. */
const HWS = "[ \\t]*";
const SSOT_VISIBLE_LINE_RE = new RegExp(`^${HWS}source-of-truth:${HWS}(.+?)${HWS}$`, "gim");
const LEGACY_BANNER_LINE_RE = new RegExp(
	`^${HWS}\\*\\*Source of truth for\\*\\*${HWS}(.+?)${HWS}$`,
	"gim",
);

/** @deprecated Prefer parseSsot — presence-only legacy check. */
export const SOURCE_OF_TRUTH_BANNER_RE = /\*\*Source of truth for\*\*/;
export const SOURCE_OF_TRUTH_BANNER_LINE_RE = /^\s*\*\*Source of truth for\*\*/m;

function cleanSummary(raw: string): string {
	return raw.replace(/\s+/g, " ").trim().replace(/\.$/, "").trim();
}

/** Drop fenced + inline code so authoring examples do not count as SSOT markers. */
function stripCode(content: string): string {
	return content.replace(/```[\s\S]*?```/g, "\n").replace(/`[^`\n]+`/g, " ");
}

function collectMatches(re: RegExp, content: string): string[] {
	const out: string[] = [];
	re.lastIndex = 0;
	let match = re.exec(content);
	while (match) {
		const summary = cleanSummary(match[1] ?? "");
		if (summary) out.push(summary);
		match = re.exec(content);
	}
	return out;
}

/**
 * Parse SSOT from markdown. Opt-in: `none` is valid (file not in catalog).
 * Dual encodings (comment + visible, etc.) or empty payloads are errors.
 */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: intentional control flow
export function parseSsot(content: string): SsotParseResult {
	const prose = stripCode(content);
	const comments = collectMatches(SSOT_COMMENT_RE, prose);
	const visibles = collectMatches(SSOT_VISIBLE_LINE_RE, prose);
	const legacies = collectMatches(LEGACY_BANNER_LINE_RE, prose);

	const forms: SsotForm[] = [];
	if (comments.length) forms.push("comment");
	if (visibles.length) forms.push("visible");
	if (legacies.length) forms.push("legacy");

	if (forms.length === 0) return { status: "none" };
	if (forms.length > 1) return { status: "dual", forms };

	if (comments.length > 1 || visibles.length > 1 || legacies.length > 1) {
		return { status: "malformed", detail: "multiple source-of-truth markers of the same form" };
	}

	if (comments.length === 1) {
		const summary = comments[0];
		if (!summary) return { status: "malformed", detail: "empty source-of-truth comment" };
		return { status: "ok", entry: { summary, form: "comment" } };
	}
	if (visibles.length === 1) {
		const summary = visibles[0];
		if (!summary) return { status: "malformed", detail: "empty source-of-truth line" };
		return { status: "ok", entry: { summary, form: "visible" } };
	}
	const summary = legacies[0];
	if (!summary) return { status: "malformed", detail: "empty legacy Source of truth banner" };
	return { status: "ok", entry: { summary, form: "legacy" } };
}

/** Rewrite a legacy banner to the preferred HTML comment form. */
export function rewriteLegacySsotToComment(content: string): string | null {
	const parsed = parseSsot(content);
	if (parsed.status !== "ok" || parsed.entry.form !== "legacy") return null;
	const comment = `<!-- source-of-truth: ${parsed.entry.summary} -->`;
	const next = content.replace(LEGACY_BANNER_LINE_RE, comment);
	return next === content ? null : next;
}

export function preferredSsotComment(summary: string): string {
	return `<!-- source-of-truth: ${cleanSummary(summary)} -->`;
}
