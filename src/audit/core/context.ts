import { findRepoRoot, loadConfig, retiredSkills } from "../config/load.ts";
import type { SkeletonConfig } from "../config/types.ts";
import type { PolicyFile } from "../policies/types.ts";
import {
	collectDocMetaPaths,
	collectScanFiles,
	filterDocMetaPaths,
	filterToPaths,
	includeExplicitMarkdownPaths,
} from "./collect.ts";
import { parseRegistry } from "./registry.ts";
import { buildSkillIndex, type SkillIndex } from "./skill-roots.ts";

export interface AuditContext {
	root: string;
	config: SkeletonConfig;
	files: string[];
	docMetaPaths: string[];
	registryPaths: string[];
	registryHasTableHeader: boolean;
	retiredSkills: Set<string>;
	skillIndex: SkillIndex;
	/** Compiled prose policies from plugins (empty when no plugins / no policy globs). */
	policies: PolicyFile[];
}

export interface AuditOptions {
	root?: string;
	changed?: boolean;
	paths?: string[];
	policies?: PolicyFile[];
}

export function createContext(options: AuditOptions = {}): AuditContext {
	const root = options.root ?? findRepoRoot();
	const config = loadConfig(root);
	const skillIndex = buildSkillIndex(root);
	let files = collectScanFiles(config, root, skillIndex);

	if (options.paths && options.paths.length > 0) {
		files = includeExplicitMarkdownPaths(files, options.paths, root);
		files = filterToPaths(files, options.paths, root);
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
		policies: options.policies ?? [],
	};
}
