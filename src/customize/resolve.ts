import { existsSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { findRepoRoot } from "../audit/config/load.ts";
import { parseRegistryPaths } from "../audit/core/registry.ts";
import { REGISTRY_DIR_REL, normalizeRelPath } from "../audit/core/shared.ts";

const CUSTOMIZE_PREFIX = "Customize: ";

export interface CustomizeResolveResult {
	slug: string;
	content: string | null;
	path: string | null;
}

function customizePathForSlug(root: string, slug: string): string {
	return join(root, REGISTRY_DIR_REL, "customize", `${slug}.md`);
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

export function resolveCustomize(root: string, slug: string): CustomizeResolveResult {
	const direct = customizePathForSlug(root, slug);
	if (existsSync(direct)) {
		return {
			slug,
			content: readFileSync(direct, "utf8"),
			path: normalizeRelPath(relative(root, direct)),
		};
	}

	const registryPath = findCustomizeViaRegistry(root, slug);
	if (registryPath) {
		const abs = join(root, registryPath);
		return {
			slug,
			content: readFileSync(abs, "utf8"),
			path: registryPath,
		};
	}

	return { slug, content: null, path: null };
}

export function resolveCustomizeFromRoot(slug: string, startDir?: string): CustomizeResolveResult {
	const root = findRepoRoot(startDir);
	return resolveCustomize(root, slug);
}

export { CUSTOMIZE_PREFIX };
