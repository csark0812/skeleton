import { writeFileSync } from "node:fs";
import { resolve, sep } from "node:path";
import { collectAnchorFixes } from "../fix/anchors.ts";
import { collectDocMetaFixes } from "../fix/doc-meta.ts";
import type { AuditContext } from "./context.ts";
import { DOC_META_LAST_REVIEWED_RE } from "./shared.ts";

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
	const match = DOC_META_LAST_REVIEWED_RE.exec(metaContent);
	if (!match?.[1]) return targetContent;
	const date = match[1];
	if (!DOC_META_LAST_REVIEWED_RE.test(targetContent)) return targetContent;
	return targetContent.replace(DOC_META_LAST_REVIEWED_RE, `last-reviewed=${date}`);
}

/** Resolve a write path and refuse escapes outside the repo root. */
export function resolveWritePath(root: string, relFile: string): string {
	const rootAbs = resolve(root);
	const abs = resolve(rootAbs, relFile);
	if (abs !== rootAbs && !abs.startsWith(rootAbs + sep)) {
		throw new Error(`Refusing autofix outside repo root: ${relFile}`);
	}
	return abs;
}

export function applyFixes(ctx: AuditContext, options: ApplyFixesOptions): ApplyFixesResult {
	const kinds = new Set(options.kinds);
	const edits = collectFixes(ctx, kinds);
	const modifiedFiles: string[] = [];

	if (edits.length > 0) {
		console.log("Doc audit autofix:\n");
		for (const edit of edits) {
			console.log(`- ${edit.file}: ${edit.description}`);
			if (!options.dryRun) {
				const abs = resolveWritePath(ctx.root, edit.file);
				writeFileSync(abs, edit.content, "utf8");
				modifiedFiles.push(edit.file);
			}
		}
		console.log("");
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
