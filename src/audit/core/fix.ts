import { existsSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, resolve, sep } from "node:path";
import { collectAnchorFixes } from "../fix/anchors.ts";
import { collectDocMetaFixes } from "../fix/doc-meta.ts";
import { collectSsotFixes } from "../fix/ssot.ts";
import type { AuditContext } from "./context.ts";
import { docMetaLastReviewed, replaceDocMetaLastReviewed } from "./shared.ts";
import { rewriteLegacySsotToComment } from "./ssot.ts";

export type FixKind = "doc-meta" | "anchors" | "ssot";

export interface FixEdit {
	file: string;
	description: string;
	content: string;
}

export interface ApplyFixesOptions {
	kinds: FixKind[];
	dryRun?: boolean;
}

export interface ApplyFixesResult {
	edits: FixEdit[];
	modifiedFiles: string[];
}

function collectFixes(ctx: AuditContext, kinds: Set<FixKind>): FixEdit[] {
	const meta = kinds.has("doc-meta") ? collectDocMetaFixes(ctx) : [];
	const anchors = kinds.has("anchors") ? collectAnchorFixes(ctx) : [];
	const ssot = kinds.has("ssot") ? collectSsotFixes(ctx) : [];
	return coalesceFixEdits(meta, anchors, ssot);
}

/**
 * Merge per-file snapshots so default `--fix` (doc-meta + anchors) does not
 * last-write-win. Prefer anchors content, then overlay last-reviewed from meta.
 */
/** Merge per-file fix edits: anchors content, overlay last-reviewed, then SSOT rewrite. */
export function coalesceFixEdits(
	metaEdits: FixEdit[],
	anchorEdits: FixEdit[],
	ssotEdits: FixEdit[] = [],
): FixEdit[] {
	const metaByFile = new Map(metaEdits.map((e) => [e.file, e]));
	const anchorByFile = new Map(anchorEdits.map((e) => [e.file, e]));
	const ssotByFile = new Map(ssotEdits.map((e) => [e.file, e]));
	const files = new Set([...metaByFile.keys(), ...anchorByFile.keys(), ...ssotByFile.keys()]);
	const out: FixEdit[] = [];

	for (const file of [...files].sort()) {
		out.push(
			coalesceOneFile({
				file,
				meta: metaByFile.get(file),
				anchors: anchorByFile.get(file),
				ssot: ssotByFile.get(file),
			}),
		);
	}
	return out;
}

function coalesceOneFile(input: {
	file: string;
	meta: FixEdit | undefined;
	anchors: FixEdit | undefined;
	ssot: FixEdit | undefined;
}): FixEdit {
	const { file, meta, anchors, ssot } = input;
	const descriptions: string[] = [];
	let content = anchors?.content ?? meta?.content ?? ssot?.content ?? "";
	if (meta) descriptions.push(meta.description);
	if (anchors) {
		descriptions.push(anchors.description);
		content = anchors.content;
		if (meta) content = overlayLastReviewed(content, meta.content);
	} else if (meta) {
		content = meta.content;
	}
	if (ssot) {
		descriptions.push(ssot.description);
		content = rewriteSsotOnto(content, ssot.content);
	}
	return { file, description: descriptions.join("; "), content };
}

function rewriteSsotOnto(base: string, ssotContent: string): string {
	// Re-run the narrow SSOT transform on the content that already contains
	// anchor/meta edits. Falling back to the collector snapshot is safe when
	// this is the only available edit.
	return rewriteLegacySsotToComment(base) ?? ssotContent ?? base;
}

function overlayLastReviewed(targetContent: string, metaContent: string): string {
	const date = docMetaLastReviewed(metaContent);
	if (!date) return targetContent;
	return replaceDocMetaLastReviewed(targetContent, date) ?? targetContent;
}

function underRoot(rootAbs: string, candidateAbs: string): boolean {
	return candidateAbs === rootAbs || candidateAbs.startsWith(rootAbs + sep);
}

function shouldStopPathWalk(rootResolved: string, parent: string, cursor: string): boolean {
	return parent === cursor || (!underRoot(rootResolved, parent) && parent !== rootResolved);
}

function resolveExistingRealPath(rootResolved: string, abs: string, relFile: string): string {
	const rootReal = existsSync(rootResolved) ? realpathSync(rootResolved) : rootResolved;
	let cursor = abs;
	while (!existsSync(cursor)) {
		const parent = dirname(cursor);
		if (shouldStopPathWalk(rootResolved, parent, cursor)) return abs;
		cursor = parent;
	}
	const real = realpathSync(cursor);
	if (!underRoot(rootReal, real)) {
		throw new Error(`Refusing autofix outside repo root: ${relFile}`);
	}
	return abs;
}

/** Resolve a write path and refuse escapes outside the repo root (incl. symlinks). */
export function resolveWritePath(root: string, relFile: string): string {
	const rootResolved = resolve(root);
	const abs = resolve(rootResolved, relFile);
	if (!underRoot(rootResolved, abs)) {
		throw new Error(`Refusing autofix outside repo root: ${relFile}`);
	}
	return resolveExistingRealPath(rootResolved, abs, relFile);
}

export function applyFixes(ctx: AuditContext, options: ApplyFixesOptions): ApplyFixesResult {
	const kinds = new Set(options.kinds);
	const edits = collectFixes(ctx, kinds);
	const modifiedFiles: string[] = [];

	if (edits.length > 0) {
		console.error("Doc audit autofix:\n");
		for (const edit of edits) {
			console.error(`- ${edit.file}: ${edit.description}`);
			if (!options.dryRun) {
				const abs = resolveWritePath(ctx.root, edit.file);
				writeFileSync(abs, edit.content, "utf8");
				modifiedFiles.push(edit.file);
			}
		}
		console.error("");
	}

	return { edits, modifiedFiles };
}

export function parseFixKinds(raw: string | true): FixKind[] {
	if (raw === true) return ["anchors", "ssot"];
	switch (raw) {
		case "doc-meta":
			return ["doc-meta"];
		case "anchors":
			return ["anchors"];
		case "ssot":
			return ["ssot"];
		default:
			throw new Error(`Unknown --fix kind: ${raw}. Use doc-meta, anchors, or ssot.`);
	}
}

/** Owning audit rule id for each fix kind (used to scope `--fix` under `--only`). */
export const FIX_KIND_RULE: Record<FixKind, string> = {
	"doc-meta": "doc-meta",
	anchors: "links",
	ssot: "ssot",
};

/** When `--only` is set, keep fix kinds whose owning rules are selected. */
export function fixKindsForOnly(kinds: FixKind[], only: Set<string> | null): FixKind[] {
	if (!only) return kinds;
	return kinds.filter((kind) => only.has(FIX_KIND_RULE[kind]));
}
