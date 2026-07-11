import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const MODULE_DIR = dirname(fileURLToPath(import.meta.url));

const PACKAGE_ROOT_CANDIDATES = [
	join(MODULE_DIR, "../.."),
	join(MODULE_DIR, ".."),
];

export function resolvePackageRoot(): string {
	for (const candidate of PACKAGE_ROOT_CANDIDATES) {
		if (existsSync(join(candidate, "package.json"))) return candidate;
	}
	throw new Error("Could not resolve @csark0812/skeleton package root");
}

export function resolveTemplatesDir(): string {
	const dir = join(resolvePackageRoot(), "templates/skeleton-init");
	if (!existsSync(dir)) {
		throw new Error("Missing templates/skeleton-init in package");
	}
	return dir;
}
