import { spawnSync } from "node:child_process";
import { normalizeRelPath } from "./shared.ts";

/**
 * Review proof lives in commit messages, not in a tracked file.
 *
 * `skeleton attest` adds a commit whose message carries one line per reviewed document:
 *
 *     Skeleton-Reviewed: docs/a.md doc=sha256:<16hex> deps=sha256:<16hex>|none
 *     Skeleton-Review-Note: docs/a.md <what the reviewer checked>
 *
 * A document is reviewed when its current digests equal the digests of some attestation
 * reachable from HEAD. Nothing tracked changes, so two branches that review the same
 * document never conflict; git merges the document itself as usual. Lines are read
 * anywhere in a message, because a squash merge joins every commit body into one.
 */

export const REVIEWED_PREFIX = "Skeleton-Reviewed:";
export const NOTE_PREFIX = "Skeleton-Review-Note:";

/** One recorded review of one document. */
export interface Attestation {
	document: string;
	documentHash: string;
	/** Null when the document declared no review dependencies. */
	dependenciesHash: string | null;
	/** What the reviewer checked, when they said so. */
	note?: string;
	/** Commit that carries the line. */
	sha: string;
	/** UTC day of the review: `since=` (carried over by migration) or the commit's committer day. */
	day: string;
}

export type ReviewHistory =
	/** Newest attestation first, per document. Empty outside git or before the first commit. */
	| { status: "available"; byDocument: Map<string, Attestation[]> }
	/** History exists but is incomplete, so a missing attestation proves nothing. */
	| { status: "unavailable"; reason: string };

export interface AttestationLine {
	document: string;
	documentHash: string;
	dependenciesHash: string | null;
	note?: string;
	since?: string;
}

const DIGEST = "sha256:[a-f0-9]{16}";
const REVIEWED_RE = new RegExp(
	`^${REVIEWED_PREFIX} (\\S+|"(?:[^"\\\\]|\\\\.)*") doc=(${DIGEST}) deps=(${DIGEST}|none)(?: since=(\\d{4}-\\d{2}-\\d{2}))?\\s*$`,
);
const NOTE_RE = new RegExp(`^${NOTE_PREFIX} (\\S+|"(?:[^"\\\\]|\\\\.)*") (.+)$`);

/** A path that a message line can carry: bare when it has no space or quote, else JSON-quoted. */
function pathToken(document: string): string {
	return /^[^\s"]+$/.test(document) ? document : JSON.stringify(document);
}

function parsePathToken(token: string): string | null {
	if (!token.startsWith('"')) return normalizeRelPath(token);
	try {
		return normalizeRelPath(JSON.parse(token) as string);
	} catch {
		return null;
	}
}

/** The message lines that record these reviews, one per document, notes after their line. */
export function formatAttestationLines(lines: AttestationLine[]): string[] {
	return lines.flatMap((line) => {
		const path = pathToken(line.document);
		const since = line.since ? ` since=${line.since}` : "";
		const reviewed = `${REVIEWED_PREFIX} ${path} doc=${line.documentHash} deps=${line.dependenciesHash ?? "none"}${since}`;
		const note = line.note?.replace(/[\r\n]+/g, " ").trim();
		return note ? [reviewed, `${NOTE_PREFIX} ${path} ${note}`] : [reviewed];
	});
}

function parseReviewedLine(text: string): AttestationLine | null {
	const match = REVIEWED_RE.exec(text);
	const document = match ? parsePathToken(match[1] ?? "") : null;
	if (!(match && document)) return null;
	return {
		document,
		documentHash: match[2] ?? "",
		dependenciesHash: match[3] === "none" ? null : (match[3] ?? null),
		...(match[4] ? { since: match[4] } : {}),
	};
}

function parseNoteLine(text: string): [string, string] | null {
	const match = NOTE_RE.exec(text);
	const document = match ? parsePathToken(match[1] ?? "") : null;
	return match && document ? [document, (match[2] ?? "").trim()] : null;
}

/** Every review line in one commit message, wherever it sits in the message. */
export function parseAttestationLines(message: string): AttestationLine[] {
	const texts = message.split(/\r?\n/).map((raw) => raw.trim());
	const notes = new Map(texts.map(parseNoteLine).filter((note) => note !== null));
	const lines = texts.map(parseReviewedLine).filter((line) => line !== null);
	return lines.map((line) => {
		const note = notes.get(line.document);
		return note ? { ...line, note } : line;
	});
}

export function git(root: string, args: string[], input?: string) {
	return spawnSync("git", args, {
		cwd: root,
		encoding: "utf8",
		input,
		maxBuffer: 200_000_000,
	});
}

function gitOk(root: string, args: string[]): string | null {
	const proc = git(root, args);
	return proc.status === 0 ? proc.stdout.trim() : null;
}

export function headCommit(root: string): string | null {
	return gitOk(root, ["rev-parse", "--verify", "-q", "HEAD"]);
}

function utcDay(isoDate: string): string {
	return new Date(isoDate).toISOString().slice(0, 10);
}

/** Read every attestation reachable from HEAD in one `git log` pass. */
export function readReviewHistory(root: string): ReviewHistory {
	const byDocument = new Map<string, Attestation[]>();
	if (gitOk(root, ["rev-parse", "--is-inside-work-tree"]) !== "true") {
		return { status: "available", byDocument };
	}
	if (gitOk(root, ["rev-parse", "--is-shallow-repository"]) === "true") {
		return {
			status: "unavailable",
			reason:
				"shallow clone: review proof lives in commit history; fetch it with `git fetch --unshallow`",
		};
	}
	if (headCommit(root) === null) return { status: "available", byDocument };
	const proc = git(root, [
		"log",
		"HEAD",
		`--grep=^${REVIEWED_PREFIX}`,
		"--format=%H%x00%cI%x00%B%x1e",
	]);
	if (proc.status !== 0) {
		return { status: "unavailable", reason: `git log failed: ${proc.stderr.trim()}` };
	}
	for (const attestation of attestationsInLog(proc.stdout)) {
		const reviews = byDocument.get(attestation.document) ?? [];
		byDocument.set(attestation.document, [...reviews, attestation]);
	}
	return { status: "available", byDocument };
}

/** Attestations in `git log --format=%H%x00%cI%x00%B%x1e` output, newest commit first. */
function attestationsInLog(output: string): Attestation[] {
	return output.split("\x1e").flatMap((record) => {
		const [sha, committed, message] = record.replace(/^\n/, "").split("\x00");
		if (!(sha && committed && message !== undefined)) return [];
		return parseAttestationLines(message).map((line) => ({
			document: line.document,
			documentHash: line.documentHash,
			dependenciesHash: line.dependenciesHash,
			...(line.note ? { note: line.note } : {}),
			sha,
			day: line.since ?? utcDay(committed),
		}));
	});
}

/** Review lines added by the commits in `from..to`, newest first. */
export function attestationsInRange(root: string, from: string, to: string): AttestationLine[] {
	const proc = git(root, [
		"log",
		`${from}..${to}`,
		`--grep=^${REVIEWED_PREFIX}`,
		"--format=%B%x1e",
	]);
	if (proc.status !== 0) return [];
	return proc.stdout.split("\x1e").flatMap((message) => parseAttestationLines(message));
}

/**
 * True when the latest first-parent commit that changed any of `paths` landed a review of
 * `document`: a squash whose message reviews it, or a merge whose merged side does. Then the
 * current bytes are a combination of reviewed edits that no one has read as a whole.
 */
export function landedReviewOf(input: {
	root: string;
	document: string;
	paths: string[];
	history: Map<string, Attestation[]>;
}): boolean {
	const reviews = new Set((input.history.get(input.document) ?? []).map((review) => review.sha));
	if (reviews.size === 0 || input.paths.length === 0) return false;
	const latest = gitOk(input.root, [
		"log",
		"--first-parent",
		"-1",
		"--format=%H %P",
		"HEAD",
		"--",
		...input.paths.map((path) => `:(literal)${path}`),
	]);
	const [sha, first, second] = (latest ?? "").split(" ");
	if (!sha) return false;
	if (!(first && second)) return reviews.has(sha);
	const merged = gitOk(input.root, ["rev-list", `${first}..${second}`]);
	return (merged ?? "").split("\n").some((commit) => reviews.has(commit));
}

/** Add an empty commit on HEAD carrying `message`. The index and worktree are untouched. */
export function commitOnHead(root: string, message: string): string {
	const head = headCommit(root);
	if (head === null)
		throw new Error("Cannot attest before the first commit; commit the documents first");
	const sign = gitOk(root, ["config", "--bool", "commit.gpgsign"]) === "true" ? ["-S"] : [];
	const created = git(
		root,
		["commit-tree", ...sign, "HEAD^{tree}", "-p", head, "-F", "-"],
		message,
	);
	const sha = created.stdout.trim();
	if (created.status !== 0 || !sha) {
		throw new Error(`git commit-tree failed: ${created.stderr.trim()}`);
	}
	const moved = git(root, ["update-ref", "-m", "skeleton attest", "HEAD", sha, head]);
	if (moved.status !== 0) throw new Error(`git update-ref failed: ${moved.stderr.trim()}`);
	return sha;
}
