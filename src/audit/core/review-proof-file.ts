import { parse as parseToml } from "smol-toml";
import { normalizeRelPath } from "./shared.ts";

/**
 * The review lock: `.skeleton/review-lock.toml`, one TOML inline table per document,
 * a blank line between entries.
 *
 * Each entry is one line, and TOML requires an inline table to stay on one line, so no
 * formatter can wrap it. The blank line is load-bearing: git's three-way merge treats edits
 * to neighbouring lines as one conflict, so two pull requests that re-attest neighbouring
 * documents would collide without it. With one unchanged line between entries those in-place
 * re-attests merge cleanly. Two pull requests that re-attest the same document still conflict,
 * as they should, and so can an inserted or removed entry next to a re-attested one;
 * `--fix=review-proof` resolves both.
 */

export const REVIEW_LOCK_VERSION = 4;

export const REVIEW_LOCK_HEADER = [
	"# Skeleton review lock. Written by `skeleton audit docs --fix=doc-meta --confirm-reviewed`.",
	"# One entry per document. Do not edit by hand; keep the blank line between entries.",
	`version = ${REVIEW_LOCK_VERSION}`,
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

const DIGEST_RE = /^sha256:[a-f0-9]{16}$/;
const ENTRY_RE =
	/^("(?:[^"\\]|\\.)*") = \{ doc = "(sha256:[a-f0-9]{16})"(?:, deps = "(sha256:[a-f0-9]{16})")? \}$/;
const VERSION_RE = /^version = (\d+)$/;
const CONFLICT_MARKER_RE = /^(<{7}|={7}|>{7}|\|{7})(\s|$)/;

/** A TOML basic-string key. JSON escaping is TOML-compatible except for DEL. */
function tomlKey(document: string): string {
	if (/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(document)) {
		throw new Error(`Review lock path is not valid Unicode: ${document}`);
	}
	if (document === "version") throw new Error("Cannot record a document at the path `version`");
	return JSON.stringify(document).replace(/\u007f/g, "\\u007F");
}

/** Decode a key the fast path wrote; anything else falls through to the TOML parser. */
function decodeKey(quoted: string): string | null {
	if (quoted.includes("\\/")) return null;
	try {
		const key: unknown = JSON.parse(quoted);
		return typeof key === "string" ? key : null;
	} catch {
		return null;
	}
}

function parseEntryLine(line: string): ReviewProofEntry | null {
	const match = ENTRY_RE.exec(line);
	const document = match?.[1] ? decodeKey(match[1]) : null;
	if (!(document && match?.[2])) return null;
	return { document, documentHash: match[2], dependenciesHash: match[3] ?? null };
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Read a hand-reformatted but valid TOML lock. The next write restores the canonical layout. */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: each key is checked for the exact entry shape before any entry is trusted
function parseAsToml(content: string): Map<string, ReviewProofEntry> | null {
	let parsed: unknown;
	try {
		parsed = parseToml(content);
	} catch {
		return null;
	}
	if (!isRecord(parsed) || parsed.version !== REVIEW_LOCK_VERSION) return null;
	const entries = new Map<string, ReviewProofEntry>();
	for (const [document, value] of Object.entries(parsed)) {
		if (document === "version") continue;
		if (!(isRecord(value) && typeof value.doc === "string" && DIGEST_RE.test(value.doc))) {
			return null;
		}
		const deps = value.deps;
		if (deps !== undefined && !(typeof deps === "string" && DIGEST_RE.test(deps))) return null;
		const path = normalizeRelPath(document);
		entries.set(path, { document: path, documentHash: value.doc, dependenciesHash: deps ?? null });
	}
	return entries;
}

/** Parse the review lock. Comments and blank lines are ignored; spacing is restored on write. */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: one pass classifies comment, version, conflict-marker, and entry lines so a conflicted lock is never mistaken for a clean one
export function parseReviewProofFile(content: string): ParsedReviewProofFile {
	const candidates: ReviewProofEntry[] = [];
	let conflicted = false;
	let firstBadLine: number | null = null;
	let versionLine: number | null = null;
	// A CRLF checkout must parse the same as the LF file Skeleton writes.
	for (const [index, line] of content.split(/\r?\n/).entries()) {
		if (line.trim() === "" || line.startsWith("#")) continue;
		if (CONFLICT_MARKER_RE.test(line)) {
			conflicted = true;
			continue;
		}
		const version = VERSION_RE.exec(line);
		if (version) {
			if (versionLine !== null || Number(version[1]) !== REVIEW_LOCK_VERSION) {
				return { status: "invalid", line: index + 1 };
			}
			versionLine = index + 1;
			continue;
		}
		const entry = parseEntryLine(line);
		if (entry) candidates.push(entry);
		else firstBadLine ??= index + 1;
	}
	if (firstBadLine !== null) {
		if (conflicted) return { status: "invalid", line: firstBadLine };
		const entries = parseAsToml(content);
		return entries ? { status: "valid", entries } : { status: "invalid", line: firstBadLine };
	}
	const entries = new Map<string, ReviewProofEntry>();
	for (const entry of candidates) {
		if (entries.has(entry.document)) conflicted = true;
		entries.set(entry.document, entry);
	}
	if (versionLine === null && !conflicted) return { status: "invalid", line: 1 };
	return conflicted ? { status: "conflicted", candidates } : { status: "valid", entries };
}

function entryKey(document: string): string {
	return tomlKey(document);
}

export function formatReviewProofEntry(entry: ReviewProofEntry): string {
	const deps = entry.dependenciesHash === null ? "" : `, deps = "${entry.dependenciesHash}"`;
	return `${entryKey(entry.document)} = { doc = "${entry.documentHash}"${deps} }`;
}

/** Canonical lock: header, entries sorted by path, one blank line between entries. */
export function formatReviewProofFile(entries: Iterable<ReviewProofEntry>): string {
	const lines = [...entries]
		.sort((a, b) => (a.document < b.document ? -1 : a.document > b.document ? 1 : 0))
		.map(formatReviewProofEntry);
	return `${[REVIEW_LOCK_HEADER.join("\n"), ...lines].join("\n\n")}\n`;
}

/** 1-based line number of a document's entry in a canonical lock, or null when absent. */
export function reviewProofEntryLine(content: string, document: string): number | null {
	// Plain quoting is enough to find a line; only writing must reject untrepresentable paths.
	const prefix = `${JSON.stringify(document).replace(/\u007f/g, "\\u007F")} = `;
	const index = content.split(/\r?\n/).findIndex((line) => line.startsWith(prefix));
	return index === -1 ? null : index + 1;
}
