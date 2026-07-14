import { existsSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, resolve, sep } from "node:path";
import { collectAnchorFixes } from "../fix/anchors.ts";
import { collectDocMetaFixes } from "../fix/doc-meta.ts";
import type { AuditContext } from "./context.ts";
import { docMetaLastReviewed, replaceDocMetaLastReviewed } from "./shared.ts";

export type FixKind = "doc-meta" | "anchors";

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
	return coalesceFixEdits(meta, anchors);
}

/**
 * Merge per-file snapshots so default `--fix` (doc-meta + anchors) does not
 * last-write-win. Prefer anchors content, then overlay last-reviewed from meta.
 */
export function coalesceFixEdits(metaEdits: FixEdit[], anchorEdits: FixEdit[]): FixEdit[] {
	const metaByFile = new Map(metaEdits.map((e) => [e.file, e]));
	const anchorByFile = new Map(anchorEdits.map((e) => [e.file, e]));
	const files = new Set([...metaByFile.keys(), ...anchorByFile.keys()]);
	const out: FixEdit[] = [];

	for (const file of [...files].sort()) {
		const meta = metaByFile.get(file);
		const anchors = anchorByFile.get(file);
		if (meta && anchors) {
			out.push({
				file,
				description: `${meta.description}; ${anchors.description}`,
				content: overlayLastReviewed(anchors.content, meta.content),
			});
		} else if (meta) {
			out.push(meta);
		} else if (anchors) {
			out.push(anchors);
		}
	}

	return out;
}

function overlayLastReviewed(targetContent: string, metaContent: string): string {
	const date = docMetaLastReviewed(metaContent);
	if (!date) return targetContent;
	return replaceDocMetaLastReviewed(targetContent, date) ?? targetContent;
}

function underRoot(rootAbs: string, candidateAbs: string): boolean {
	return candidateAbs === rootAbs || candidateAbs.startsWith(rootAbs + sep);
}

/** Resolve a write path and refuse escapes outside the repo root (incl. symlinks). */
export function resolveWritePath(root: string, relFile: string): string {
	const rootResolved = resolve(root);
	const abs = resolve(rootResolved, relFile);
	if (!underRoot(rootResolved, abs)) {
		throw new Error(`Refusing autofix outside repo root: ${relFile}`);
	}

	const rootReal = existsSync(rootResolved) ? realpathSync(rootResolved) : rootResolved;

	if (existsSync(abs)) {
		const real = realpathSync(abs);
		if (!underRoot(rootReal, real)) {
			throw new Error(`Refusing autofix outside repo root: ${relFile}`);
		}
		return abs;
	}

	const parent = dirname(abs);
	if (existsSync(parent)) {
		const parentReal = realpathSync(parent);
		if (!underRoot(rootReal, parentReal)) {
			throw new Error(`Refusing autofix outside repo root: ${relFile}`);
		}
	}
	return abs;
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
	if (raw === true) return ["doc-meta", "anchors"];
	switch (raw) {
		case "doc-meta":
			return ["doc-meta"];
		case "anchors":
			return ["anchors"];
		default:
			throw new Error(`Unknown --fix kind: ${raw}. Use doc-meta or anchors.`);
	}
}

/** Owning audit rule id for each fix kind (used to scope `--fix` under `--only`). */
export const FIX_KIND_RULE: Record<FixKind, string> = {
	"doc-meta": "doc-meta",
	anchors: "links",
};

/** When `--only` is set, keep fix kinds whose owning rules are selected. */
export function fixKindsForOnly(kinds: FixKind[], only: Set<string> | null): FixKind[] {
	if (!only) return kinds;
	return kinds.filter((kind) => only.has(FIX_KIND_RULE[kind]));
}
