import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { openai } from "@post-print/agent-harness";
import { describe, expect } from "@post-print/agent-test";

const test = describe("Install the published package", ({ agent }) => ({
	installer: agent({
		agent: openai({ model: "gpt-5.6-luna", networkAccess: true }),
		workspace: "tests/fixtures/efficacy/product-smoke/adopt-consumer",
	}),
}));

test("installs and initializes Skeleton", async ({ installer }) => {
	const run = await installer.run({
		prompt: "Install @csark0812/skeleton with npm, then initialize Skeleton in this repository.",
	});
	expect(run).toHaveExecutedCommand({ command: /npm install/, exitCode: 0 });
	expect(run).toHaveExecutedCommand({ command: /@csark0812\/skeleton/, exitCode: 0 });
	expect(run).toHaveExecutedCommand({ command: /\binit\b/, exitCode: 0 });
	const installed = JSON.parse(
		await readFile(
			join(run.workspace.root, "node_modules/@csark0812/skeleton/package.json"),
			"utf8",
		),
	);
	expect(installed.name).toBe("@csark0812/skeleton");
	expect(run.workspace.changedPaths).toContain("skeleton.toml");
});
