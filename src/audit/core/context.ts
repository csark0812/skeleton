import {
	collectDocMetaPaths,
	collectScanFiles,
	filterDocMetaPaths,
	filterToPaths,
} from "./collect.ts";
import { findRepoRoot, loadConfig, retiredSkills } from "../config/load.ts";
import type { SkeletonConfig } from "../config/types.ts";
import { parseRegistry } from "./registry.ts";

export interface AuditContext {
	root: string;
	config: SkeletonConfig;
	files: string[];
	docMetaPaths: string[];
	registryPaths: string[];
	registryHasTableHeader: boolean;
	retiredSkills: Set<string>;
}

export interface AuditOptions {
	root?: string;
	changed?: boolean;
	paths?: string[];
}

export function createContext(options: AuditOptions = {}): AuditContext {
	const root = options.root ?? findRepoRoot();
	const config = loadConfig(root);
	let files = collectScanFiles(config, root);

	if (options.paths && options.paths.length > 0) {
		files = filterToPaths(files, options.paths, root);
	}

	const registry = parseRegistry(root);
	const allDocMetaPaths = collectDocMetaPaths(config, root, registry.paths);

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
	};
}
