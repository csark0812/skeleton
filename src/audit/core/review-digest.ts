import { createHash } from "node:crypto";
import { posix } from "node:path";
import { selectedRegion } from "./selectors.ts";
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

function isJson(content: string): boolean {
	try {
		JSON.parse(content);
		return true;
	} catch {
		return false;
	}
}

/**
 * Digest of the selected regions only (`package.json#scripts`, `src/run.ts#parseArgs`,
 * `docs/a.md#install`); a selector that names nothing is part of the evidence.
 * Null for unparseable JSON, so the caller binds the raw bytes.
 */
function selectedDigest(target: string, content: string, selectors: string[]): string | null {
	if (/\.json$/i.test(target) && !isJson(content)) return null;
	return sha256(
		selectors
			.map((selector) => {
				const region = selectedRegion(target, content, selector);
				return `${selector}=${region === null ? "<missing>" : region.text}`;
			})
			.join("\n"),
	);
}

/**
 * Digest that binds a review to one dependency.
 * Selected regions (a JSON key path, a heading's section, a JS/TS declaration) are compared on
 * their own;
 * a `package.json` is compared as parsed JSON without its top-level `version`;
 * a Markdown dependency is compared without its doc-meta comment;
 * every other dependency is compared byte for byte.
 */
export function dependencyDigest(target: string, content: string, selectors?: string[]): string {
	if (selectors && selectors.length > 0) {
		const selected = selectedDigest(target, content, selectors);
		if (selected !== null) return selected;
	}
	if (isMarkdown(target)) return fullDocumentDigest(content);
	if (!isPackageManifest(target)) return sha256(content);
	const manifest = manifestWithoutReleaseVersion(content);
	return manifest === null ? sha256(content) : sha256(manifest);
}
