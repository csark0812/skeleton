/**
 * The review proof file: one line per document, a blank line between entries.
 *
 * The blank line is load-bearing. Git's three-way merge treats edits to neighbouring
 * lines as one conflict, so two pull requests that re-attest neighbouring documents
 * would collide without it. With one unchanged line between entries those in-place
 * re-attests merge cleanly. Two pull requests that re-attest the same document still
 * conflict, as they should, and so can an inserted or removed entry next to a
 * re-attested one; `--fix=review-proof` resolves both.
 */

export const REVIEW_PROOF_HEADER = [
	"# Skeleton review proof. Written by `skeleton audit docs --fix=doc-meta --confirm-reviewed`.",
	"# One entry per document. Do not edit by hand; keep the blank line between entries.",
];

/** Review evidence for one document: its own digest and one digest over its dependencies. */
export interface ReviewProofEntry {
	document: string;
	documentHash: string;
	/** Null when the document declares no review dependencies. */
	dependenciesHash: string | null;
}

export type ParsedReviewProofFile =
	| { status: "valid"; entries: Map<string, ReviewProofEntry> }
	/** Merge-conflict markers or duplicate entries: every candidate entry from every side. */
	| { status: "conflicted"; candidates: ReviewProofEntry[] }
	| { status: "invalid"; line: number };

const DIGEST = "sha256:[a-f0-9]{16}";
const ENTRY_RE = new RegExp(`^(.+?) doc=(${DIGEST}) deps=(${DIGEST}|none)$`);
const CONFLICT_MARKER_RE = /^(<{7}|={7}|>{7}|\|{7})(\s|$)/;

function parseEntry(line: string): ReviewProofEntry | null {
	const match = ENTRY_RE.exec(line);
	if (!(match?.[1] && match[2] && match[3])) return null;
	return {
		document: match[1],
		documentHash: match[2],
		dependenciesHash: match[3] === "none" ? null : match[3],
	};
}

/** Parse the proof file. Comments and blank lines are ignored; spacing is restored on write. */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: one pass classifies comment, conflict-marker, and entry lines so a conflicted file is never mistaken for a clean one
export function parseReviewProofFile(content: string): ParsedReviewProofFile {
	const candidates: ReviewProofEntry[] = [];
	let conflicted = false;
	// A CRLF checkout must parse the same as the LF file Skeleton writes.
	const lines = content.split(/\r?\n/);
	for (const [index, line] of lines.entries()) {
		if (line.trim() === "" || line.startsWith("#")) continue;
		if (CONFLICT_MARKER_RE.test(line)) {
			conflicted = true;
			continue;
		}
		const entry = parseEntry(line);
		if (!entry) return { status: "invalid", line: index + 1 };
		candidates.push(entry);
	}
	const entries = new Map<string, ReviewProofEntry>();
	for (const entry of candidates) {
		if (entries.has(entry.document)) conflicted = true;
		entries.set(entry.document, entry);
	}
	return conflicted ? { status: "conflicted", candidates } : { status: "valid", entries };
}

export function formatReviewProofEntry(entry: ReviewProofEntry): string {
	return `${entry.document} doc=${entry.documentHash} deps=${entry.dependenciesHash ?? "none"}`;
}

/** Canonical file: header, entries sorted by path, one blank line between entries. */
export function formatReviewProofFile(entries: Iterable<ReviewProofEntry>): string {
	const lines = [...entries]
		.sort((a, b) => (a.document < b.document ? -1 : a.document > b.document ? 1 : 0))
		.map(formatReviewProofEntry);
	return `${[REVIEW_PROOF_HEADER.join("\n"), ...lines].join("\n\n")}\n`;
}

/** 1-based line number of a document's entry in a canonical file, or null when absent. */
export function reviewProofEntryLine(content: string, document: string): number | null {
	const prefix = `${document} doc=`;
	const index = content.split(/\r?\n/).findIndex((line) => line.startsWith(prefix));
	return index === -1 ? null : index + 1;
}
