import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { MergeAction } from "./merge-scripts.ts";
import { resolveTemplatesDir } from "./package-paths.ts";

const TEMPLATES_DIR = resolveTemplatesDir();
const PRECOMMIT_NAME = ".pre-commit-config.yaml";
const HOOK_ID = "id: skeleton-validate-staged";

const LOCAL_HOOK_BLOCK = `  - repo: local
    hooks:
      - id: skeleton-validate-staged
        name: skeleton validate changed (staged)
        entry: node node_modules/@csark0812/skeleton/dist/cli.js validate changed --staged
        language: system
        pass_filenames: false
`;

export function mergePrecommitConfig(cwd: string): MergeAction {
	const target = join(cwd, PRECOMMIT_NAME);
	const template = readFileSync(join(TEMPLATES_DIR, "pre-commit-config.yaml"), "utf8");
	if (!existsSync(target)) {
		writeFileSync(target, template, "utf8");
		return "added";
	}
	const existing = readFileSync(target, "utf8");
	if (existing.includes(HOOK_ID)) return "skipped";
	const suffix = existing.includes("repos:") ? `\n${LOCAL_HOOK_BLOCK}` : `\n${template}`;
	writeFileSync(target, `${existing.trimEnd()}${suffix}`, "utf8");
	return "updated";
}
