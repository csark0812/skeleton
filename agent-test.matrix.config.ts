import { claude, cursor, openai } from "@post-print/agent-harness";
import { defineConfig } from "@post-print/agent-test";

export default defineConfig({
	testDir: "./agent-suites",
	testMatch: "**/*.spec.ts",
	outputDir: "test-results/agent-test-matrix",
	timeout: 3_600_000,
	retries: 0,
	workers: 1,
	judge: openai({ model: "gpt-5.6-luna" }),
	projects: [
		{ name: "openai", agent: openai({ model: "gpt-5.6-luna" }) },
		{
			name: "claude",
			agent: claude(),
			testIgnore: ["**/product-smoke/**", "**/adoption-maintenance.spec.ts"],
		},
		{
			name: "cursor",
			agent: cursor(),
			testIgnore: ["**/product-smoke/**", "**/adoption-maintenance.spec.ts"],
		},
	],
});
