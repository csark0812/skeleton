import { existsSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import {
	REGISTRY_DIR_REL,
	REGISTRY_REL_PATH,
	normalizeRelPath,
} from "./shared.ts";

const REGISTRY_TABLE_ROW_RE = /^\|\s*[^|]+\|\s*\[[^\]]*\]\(([^)]+)\)\s*\|/;
export const REGISTRY_TABLE_HEADER_RE =
	/\|\s*Topic\s*\|\s*Canonical file\s*\|/i;

export interface RegistryParseResult {
	paths: string[];
	hasTableHeader: boolean;
}

/** Parse canonical paths from .skeleton/registry.md (repo-relative). */
export function parseRegistry(root: string): RegistryParseResult {
	const abs = join(root, REGISTRY_REL_PATH);
	if (!existsSync(abs)) {
		return { paths: [], hasTableHeader: false };
	}
	const content = readFileSync(abs, "utf8");
	const hasTableHeader = REGISTRY_TABLE_HEADER_RE.test(content);
	const paths: string[] = [];

	for (const line of content.split("\n")) {
		const match = REGISTRY_TABLE_ROW_RE.exec(line);
		if (!match?.[1]) continue;
		const linkTarget = match[1].trim();
		if (linkTarget.startsWith("#")) continue;
		const resolved = resolve(join(root, REGISTRY_DIR_REL), linkTarget);
		paths.push(normalizeRelPath(relative(root, resolved)));
	}

	return { paths: [...new Set(paths)], hasTableHeader };
}

/** @deprecated alias — returns paths only */
export function parseRegistryPaths(root: string): string[] {
	return parseRegistry(root).paths;
}
