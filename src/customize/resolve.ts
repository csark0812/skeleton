import { existsSync, readFileSync } from "node:fs";
import { basename, join, relative } from "node:path";
import { findRepoRoot, loadConfig } from "../audit/config/load.ts";
import { parseRegistryPaths } from "../audit/core/registry.ts";
import { REGISTRY_DIR_REL, normalizeRelPath } from "../audit/core/shared.ts";

const CUSTOMIZE_PREFIX = "Customize: ";

export interface CustomizeResolveResult {
	slug: string;
	content: string | null;
	path: string | null;
	/** Paths under `.skeleton/customize/` that were concatenated into content. */
	included: string[];
}

function customizeDir(root: string): string {
	return join(root, REGISTRY_DIR_REL, "customize");
}

function customizePathForSlug(root: string, slug: string): string {
	return join(customizeDir(root), `${slug}.md`);
}

function findCustomizeViaRegistry(root: string, slug: string): string | null {
	for (const rel of parseRegistryPaths(root)) {
		const expected = `${REGISTRY_DIR_REL}/customize/${slug}.md`;
		if (normalizeRelPath(rel) === expected && existsSync(join(root, rel))) {
			return rel;
		}
	}
	return null;
}

function resolveSlugFile(
	root: string,
	slug: string,
): { content: string | null; path: string | null } {
	const direct = customizePathForSlug(root, slug);
	if (existsSync(direct)) {
		return {
			content: readFileSync(direct, "utf8"),
			path: normalizeRelPath(relative(root, direct)),
		};
	}

	const registryPath = findCustomizeViaRegistry(root, slug);
	if (registryPath) {
		const abs = join(root, registryPath);
		return {
			content: readFileSync(abs, "utf8"),
			path: registryPath,
		};
	}

	return { content: null, path: null };
}

function alwaysIncludeBasenames(root: string): string[] {
	try {
		const config = loadConfig(root);
		return config.customize?.alwaysInclude ?? [];
	} catch {
		return [];
	}
}

function readAlwaysInclude(
	root: string,
	basenames: string[],
	skipBasename: string | null,
): { parts: string[]; paths: string[] } {
	const parts: string[] = [];
	const paths: string[] = [];
	const dir = customizeDir(root);

	for (const name of basenames) {
		const file = basename(name);
		if (skipBasename && file === skipBasename) continue;
		const abs = join(dir, file);
		if (!existsSync(abs)) continue;
		parts.push(readFileSync(abs, "utf8").trimEnd());
		paths.push(normalizeRelPath(relative(root, abs)));
	}

	return { parts, paths };
}

export function resolveCustomize(root: string, slug: string): CustomizeResolveResult {
	const slugFile = resolveSlugFile(root, slug);
	const alwaysNames = alwaysIncludeBasenames(root);
	const skip =
		slugFile.path != null ? basename(slugFile.path) : null;
	const always = readAlwaysInclude(root, alwaysNames, skip);

	const parts: string[] = [];
	const included: string[] = [];

	if (slugFile.content != null && slugFile.content.trim().length > 0) {
		parts.push(slugFile.content.trimEnd());
		if (slugFile.path) included.push(slugFile.path);
	}

	parts.push(...always.parts);
	included.push(...always.paths);

	if (parts.length === 0) {
		return { slug, content: null, path: slugFile.path, included: [] };
	}

	return {
		slug,
		content: parts.join("\n\n---\n\n") + "\n",
		path: slugFile.path ?? always.paths[0] ?? null,
		included,
	};
}

export function resolveCustomizeFromRoot(
	slug: string,
	startDir?: string,
): CustomizeResolveResult {
	const root = findRepoRoot(startDir);
	return resolveCustomize(root, slug);
}

export { CUSTOMIZE_PREFIX };
