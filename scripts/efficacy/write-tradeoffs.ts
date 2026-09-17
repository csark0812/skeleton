import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const ROOT = join(import.meta.dir, "../../tests/fixtures/efficacy/tradeoffs");
const guidance =
	"# Agent entry\n\nInspect the repository. Keep behavior, tests, and related documentation accurate. Verify changes.\n";
const config =
	'daysUntilStale = 365\n[scan]\ninclude = ["docs/**", "README.md", "AGENTS.md"]\nexclude = []\n[reviewProof]\nmode = "hash"\n';
const policy = "export function orderLimit(kind: string): number { return LIMITS[kind] ?? 20; }\n";
const limits = "const LIMITS: Record<string, number> = { standard: 20, regulated: 5 };\n";
const tests =
	'import { expect, test } from "bun:test";\nimport { orderLimit } from "../src/checkout.ts";\ntest("order limits", () => { expect(orderLimit("standard")).toBe(20); expect(orderLimit("regulated")).toBe(5); expect(orderLimit("unknown")).toBe(20); });\n';

function write(root: string, path: string, text: string) {
	const target = join(ROOT, root, path);
	mkdirSync(dirname(target), { recursive: true });
	writeFileSync(target, text);
}

for (const variant of ["adoption", "truncated", "missing", "trivial"]) {
	for (const side of ["control", "skeleton"]) {
		const root = `${variant}/${side}`;
		write(root, "AGENTS.md", guidance);
		write(root, "README.md", "# Orders service\n\nOrder delviery rules live under docs/.\n");
		write(
			root,
			"package.json",
			JSON.stringify({
				name: "orders-consumer",
				private: true,
				type: "module",
				scripts: { test: "bun test ./tests" },
			}),
		);
		write(root, "src/checkout.ts", 'export { orderLimit } from "./limits.ts";\n');
		const padding = variant === "truncated" ? "// unrelated historical note\n".repeat(160) : "";
		write(root, "src/limits.ts", policy + padding + limits);
		write(root, "tests/limits.test.ts", tests);
		const marker =
			side === "skeleton" && variant !== "adoption" && variant !== "missing"
				? "<!-- source-of-truth: Order limits -->\n<!-- doc-meta: owner=eng | last-reviewed=2026-09-17 -->\n<!-- review-deps: paths=src/limits.ts,src/checkout.ts -->\n\n"
				: "";
		write(
			root,
			"docs/orders.md",
			`# Order limits\n\n${marker}Standard orders allow 20 items. Regulated orders allow 5. Unrecognized categories allow 20. The implementation is in src/limits.ts and is exposed through src/checkout.ts.\n`,
		);
		if (side === "skeleton" && variant !== "adoption") write(root, "skeleton.toml", config);
	}
}
console.log(
	"Prepared synthetic adoption, truncated-context, missing-metadata, and overhead fixtures.",
);
