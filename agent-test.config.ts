import { openai } from "@post-print/agent-harness";
import { defineConfig } from "@post-print/agent-test";

export default defineConfig({
	testDir: "./agent-suites",
	testMatch: "**/*.spec.ts",
	outputDir: "test-results/agent-test",
	timeout: 3_600_000,
	retries: 0,
	workers: 1,
	judge: openai({ model: "gpt-5.6-luna" }),
	projects: [{ name: "openai", agent: openai({ model: "gpt-5.6-luna" }) }],
});
