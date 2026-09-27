import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const INTERVENTION_ROOTS = ["dist", "templates", "schemas", "skeleton"];

export function interventionDigest(root: string) {
	const files = INTERVENTION_ROOTS.flatMap((path) => collect(join(root, path))).sort();
	if (!files.length) throw new Error("Build and package files are required before qualification.");
	const digest = createHash("sha256");
	for (const file of files) {
		digest.update(relative(root, file));
		digest.update("\0");
		digest.update(createHash("sha256").update(readFileSync(file)).digest("hex"));
		digest.update("\0");
	}
	return { algorithm: "sha256" as const, digest: digest.digest("hex"), files: files.length };
}

function collect(path: string): string[] {
	if (!existsSync(path)) return [];
	if (statSync(path).isFile()) return [path];
	return readdirSync(path).flatMap((entry) => collect(join(path, entry)));
}
