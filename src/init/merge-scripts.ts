import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { resolveTemplatesDir } from "./package-paths.ts";

const TEMPLATES_DIR = resolveTemplatesDir();

export type MergeAction = "added" | "updated" | "skipped";

export function mergePackageJsonScripts(cwd: string): MergeAction {
	const pkgPath = join(cwd, "package.json");
	if (!existsSync(pkgPath)) return "skipped";

	const fragment = JSON.parse(
		readFileSync(join(TEMPLATES_DIR, "package.json.scripts.fragment.json"), "utf8"),
	) as Record<string, string>;
	const existing = readFileSync(pkgPath, "utf8");
	const pkg = JSON.parse(existing) as {
		scripts?: Record<string, string>;
	};
	pkg.scripts ??= {};

	let changed = false;
	for (const [key, value] of Object.entries(fragment)) {
		if (pkg.scripts[key] !== value) {
			pkg.scripts[key] = value;
			changed = true;
		}
	}

	if (!changed) return "skipped";
	const indentation = /^\n([\t ]+)"/m.exec(existing)?.[1] ?? 2;
	writeFileSync(pkgPath, `${JSON.stringify(pkg, null, indentation)}\n`, "utf8");
	return "updated";
}
