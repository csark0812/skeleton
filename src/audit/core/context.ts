import { findRepoRoot, loadConfig, retiredSkills } from "../config/load.ts";
import type { SkeletonConfig } from "../config/types.ts";
import type { PolicyFile } from "../policies/types.ts";
import {
	collectDocMetaPaths,
	collectScanFiles,
	filterDocMetaPaths,
	filterToPaths,
	includeExplicitMarkdownPaths,
	relPath,
} from "./collect.ts";
import { parseRegistry } from "./registry.ts";
import {
	buildSkillIndex,
	isForeignSkillPath,
	listSkillMarkdownPaths,
	type SkillIndex,
} from "./skill-roots.ts";

export interface AuditContext {
	root: string;
	config: SkeletonConfig;
	files: string[];
	docMetaPaths: string[];
	registryPaths: string[];
	registryHasTableHeader: boolean;
	retiredSkills: Set<string>;
	skillIndex: SkillIndex;
	/**
	 * Foreign (synced) skill slugs — same as `skillIndex.foreignSlugs`.
	 * Used by doc-meta to skip consumer-side git-date freshness on upstream bodies.
	 */
	lockedSkillSlugs: Set<string>;
	/** Compiled prose policies from plugins (empty when no plugins / no policy globs). */
	policies: PolicyFile[];
}

export interface AuditOptions {
	root?: string;
	changed?: boolean;
	paths?: string[];
	policies?: PolicyFile[];
	/**
	 * Union skill-tree markdown (SKILL.md + references/**) into the corpus even when
	 * `scan.exclude` dropped them. Used by bare `audit skills` so skill-scoped prose
	 * matches path-scoped / validate `--base` prove.
	 */
	includeExcludedSkillTrees?: boolean;
}

export function createContext(options: AuditOptions = {}): AuditContext {
	const root = options.root ?? findRepoRoot();
	const config = loadConfig(root);
	const skillIndex = buildSkillIndex(root, config.skillOwnership);
	let files = collectScanFiles(config, root, skillIndex);

	if (options.includeExcludedSkillTrees) {
		files = includeExplicitMarkdownPaths(files, listSkillMarkdownPaths(root, skillIndex), root);
	}

	if (options.paths && options.paths.length > 0) {
		files = includeExplicitMarkdownPaths(files, options.paths, root);
		files = filterToPaths(files, options.paths, root);
		// Path-scoped --paths must not re-lint foreign/lockfile skill bodies
		// (same skip as validate changed / bare audit skills).
		files = files.filter((abs) => !isForeignSkillPath(relPath(abs, root), skillIndex));
	}

	const registry = parseRegistry(root);
	const allDocMetaPaths = collectDocMetaPaths(config, root, registry.paths, skillIndex);

	return {
		root,
		config,
		files,
		docMetaPaths:
			options.paths && options.paths.length > 0
				? filterDocMetaPaths(allDocMetaPaths, options.paths)
				: allDocMetaPaths,
		registryPaths: registry.paths,
		registryHasTableHeader: registry.hasTableHeader,
		retiredSkills: new Set(retiredSkills(config)),
		skillIndex,
		lockedSkillSlugs: new Set(skillIndex.foreignSlugs),
		policies: options.policies ?? [],
	};
}
