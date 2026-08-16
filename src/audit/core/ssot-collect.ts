import { readFileSync } from "node:fs";
import { relative } from "node:path";
import { normalizeRelPath } from "./shared.ts";
import { parseSsot, type SsotEntry, type SsotForm } from "./ssot.ts";

export interface SsotFileEntry extends SsotEntry {
	path: string;
}

export interface CollectSsotResult {
	entries: SsotFileEntry[];
	/** Path → dual forms or malformed detail for the ssot rule. */
	errors: Array<{ path: string; kind: "dual" | "malformed"; detail: string; forms?: SsotForm[] }>;
}

/** Collect opt-in SSOT membership from scanned markdown abs paths. */
export function collectSsotEntries(files: string[], root: string): CollectSsotResult {
	const entries: SsotFileEntry[] = [];
	const errors: CollectSsotResult["errors"] = [];

	for (const abs of files) {
		const rel = normalizeRelPath(relative(root, abs));
		if (!(rel.endsWith(".md") || rel.endsWith(".mdc"))) continue;
		const content = readFileSync(abs, "utf8");
		const parsed = parseSsot(content);
		if (parsed.status === "none") continue;
		if (parsed.status === "dual") {
			errors.push({
				path: rel,
				kind: "dual",
				detail: `multiple source-of-truth forms: ${parsed.forms.join(", ")}`,
				forms: parsed.forms,
			});
			continue;
		}
		if (parsed.status === "malformed") {
			errors.push({ path: rel, kind: "malformed", detail: parsed.detail });
			continue;
		}
		entries.push({ path: rel, summary: parsed.entry.summary, form: parsed.entry.form });
	}

	entries.sort((a, b) => a.path.localeCompare(b.path));
	return { entries, errors };
}
