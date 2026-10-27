import { createHash } from "node:crypto";
import { posix } from "node:path";
import { normalizeDocMetaForReview, normalizeRelPath } from "./shared.ts";

/** Full SHA-256 digest of UTF-8 text, as `sha256:<64 hex>`. */
export function sha256(content: string): string {
	return `sha256:${createHash("sha256").update(content, "utf8").digest("hex")}`;
}

/** Digest of a reviewed document. Doc-meta is metadata, so editing it never invalidates a review. */
function fullDocumentDigest(content: string): string {
	return sha256(normalizeDocMetaForReview(content));
}

function isPackageManifest(target: string): boolean {
	return posix.basename(normalizeRelPath(target)) === "package.json";
}

function isMarkdown(target: string): boolean {
	return /\.mdx?$/i.test(target);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Review evidence for an npm manifest without its release version.
 * Release tooling rewrites the top-level `version` field, which no reviewed claim can depend on.
 * Returns null when the manifest is not a JSON object, so the caller binds the raw bytes.
 */
function manifestWithoutReleaseVersion(content: string): string | null {
	try {
		const parsed: unknown = JSON.parse(content);
		if (!isRecord(parsed)) return null;
		const reviewed = { ...parsed };
		delete reviewed.version;
		return JSON.stringify(reviewed);
	} catch {
		return null;
	}
}

/** JSON with object keys sorted, so key order and formatting never change a digest. */
function canonicalJson(value: unknown): string {
	if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
	if (isRecord(value)) {
		const keys = Object.keys(value).sort();
		return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
	}
	return JSON.stringify(value) ?? "null";
}

/** Walk a dotted key path through objects and, by numeric segment, arrays. */
function selectedValue(root: unknown, selector: string): unknown {
	let current = root;
	for (const key of selector.split(".")) {
		if (Array.isArray(current) && /^\d+$/.test(key)) {
			current = current[Number(key)];
		} else if (isRecord(current) && key in current) {
			current = current[key];
		} else {
			return;
		}
	}
	return current;
}

/** Digest of the selected JSON key paths only; a missing key is part of the evidence. */
function selectedJsonDigest(content: string, selectors: string[]): string | null {
	try {
		const parsed: unknown = JSON.parse(content);
		return sha256(
			selectors
				.map((selector) => {
					const value = selectedValue(parsed, selector);
					return `${selector}=${value === undefined ? "<missing>" : canonicalJson(value)}`;
				})
				.join("\n"),
		);
	} catch {
		return null;
	}
}

/**
 * Digest that binds a review to one dependency.
 * Selected JSON key paths (`package.json#scripts`) are compared on their own;
 * a `package.json` is compared as parsed JSON without its top-level `version`;
 * a Markdown dependency is compared without its doc-meta comment;
 * every other dependency is compared byte for byte.
 */
export function dependencyDigest(target: string, content: string, selectors?: string[]): string {
	if (selectors && selectors.length > 0) {
		const selected = selectedJsonDigest(content, selectors);
		if (selected !== null) return selected;
	}
	if (isMarkdown(target)) return fullDocumentDigest(content);
	if (!isPackageManifest(target)) return sha256(content);
	const manifest = manifestWithoutReleaseVersion(content);
	return manifest === null ? sha256(content) : sha256(manifest);
}
