import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Run } from "@post-print/agent-test";

/** Verify actual initializer output and current review proof using the installed CLI. */
export function adoptionChecks(run: Run) {
	const root = run.workspace.root;
	const read = (path: string) =>
		existsSync(join(root, path)) ? readFileSync(join(root, path), "utf8") : "";
	const cli = join(root, "node_modules/@csark0812/skeleton/dist/cli.js");
	const context = spawnSync("node", [cli, "context", "--path", "src/limits.ts"], {
		cwd: root,
		encoding: "utf8",
		timeout: 30_000,
	});
	if (context.error || context.signal)
		throw new Error(context.error?.message ?? `Context check ended with ${context.signal}`);
	return {
		candidateInstalled:
			read("node_modules/@csark0812/skeleton/dist/cli.js") ===
			readFileSync(
				new URL(
					"../../tests/fixtures/efficacy/efficiency/package-head/node_modules/@csark0812/skeleton/dist/cli.js",
					import.meta.url,
				),
				"utf8",
			),
		configured: read("skeleton.toml").length > 0,
		guidance: read("AGENTS.md").includes("<!-- skeleton: context-guide -->"),
		scripts: read("package.json").includes('"validate:changed"'),
		hook: read(".pre-commit-config.yaml").includes("skeleton"),
		currentReview:
			context.status === 0 &&
			context.stdout.includes("document\tdocs/orders.md\tmatches-recorded-review") &&
			context.stdout.includes("source\tsrc/limits.ts"),
	};
}

/** Each continuation reports its own usage; missing phase data must not become zero. */
export function sequenceTokens(runs: Pick<Run, "usage">[]): number | undefined {
	const totals = runs.map((run) => run.usage.tokens.total);
	if (totals.some((total) => total === undefined || !Number.isFinite(total) || total <= 0)) return;
	return (totals as number[]).reduce((sum, total) => sum + total, 0);
}
