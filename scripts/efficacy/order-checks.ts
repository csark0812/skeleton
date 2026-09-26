import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import type { Run } from "@post-print/agent-test";

/** Check public behavior with tests outside the agent's control. */
export function checkOrderLimits(run: Pick<Run, "workspace">) {
	if (!existsSync(run.workspace.final.path)) throw new Error("Final snapshot is unavailable.");
	if (!existsSync(join(run.workspace.final.path, "src")))
		return { passed: false, output: "Required src directory is missing from the final result." };
	const root = mkdtempSync(join(tmpdir(), "skeleton-order-check-"));
	try {
		cpSync(join(run.workspace.final.path, "src"), join(root, "src"), { recursive: true });
		writeFileSync(
			join(root, "acceptance.test.ts"),
			`import { expect, test } from "bun:test";
import { orderLimit } from "./src/checkout.ts";
test("preserves special and fallback limits", () => {
 expect(orderLimit("standard")).toBe(30);
 expect(orderLimit("regulated")).toBe(5);
 expect(orderLimit("unknown")).toBe(20);
});`,
		);
		const result = spawnSync("bun", ["test", "acceptance.test.ts"], {
			cwd: root,
			encoding: "utf8",
			timeout: 60_000,
		});
		if (result.error || result.signal)
			throw new Error(result.error?.message ?? `Checker ended with ${result.signal}`);
		return { passed: result.status === 0, output: `${result.stdout}${result.stderr}` };
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
}

function recoveryTranscript(run: Pick<Run, "trace" | "toolCalls">) {
	const evidence = JSON.stringify({ messages: run.trace.messages, toolCalls: run.toolCalls });
	return {
		initialAction:
			evidence.includes("action\\tno-context") || evidence.includes("action\tno-context"),
		retriedQuery: evidence.includes("order limit") && evidence.includes("context"),
	};
}

/** Verify canonical recovery with the packed CLI and independently retained transcript. */
export function checkMissingContextRecovery(run: Pick<Run, "workspace" | "trace" | "toolCalls">) {
	const root = run.workspace.final.path;
	const document = join(root, "docs/orders.md");
	const cli = join(
		process.cwd(),
		"tests/fixtures/efficacy/tradeoffs/missing/skeleton/node_modules/@csark0812/skeleton/dist/cli.js",
	);
	if (![document, cli].every(existsSync))
		return {
			passed: false,
			output: "Final canonical document or prepared packed Skeleton CLI is missing.",
		};
	const content = readFileSync(document, "utf8");
	const hasOwnership =
		content.includes("source-of-truth:") && content.includes("review-deps: paths=src/limits.ts");
	const result = spawnSync("node", [cli, "context", "order limit"], {
		cwd: root,
		encoding: "utf8",
		timeout: 60_000,
	});
	const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
	const { initialAction, retriedQuery } = recoveryTranscript(run);
	const returnedOwner =
		output.includes("document\\tdocs/orders.md") || output.includes("document\tdocs/orders.md");
	const returnedSource =
		output.includes("source\\tsrc/limits.ts") || output.includes("source\tsrc/limits.ts");
	const passed =
		hasOwnership &&
		result.status === 0 &&
		initialAction &&
		retriedQuery &&
		returnedOwner &&
		returnedSource;
	return {
		passed,
		output: [
			`canonical ownership metadata: ${hasOwnership}`,
			`initial structured action observed: ${initialAction}`,
			`same-query retry observed: ${retriedQuery}`,
			`packed CLI returned owner/source: ${returnedOwner}/${returnedSource}`,
			output,
		].join("\n"),
	};
}
