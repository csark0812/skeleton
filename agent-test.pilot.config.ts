import { openai } from "@post-print/agent-harness";
import { defineConfig } from "@post-print/agent-test";

export default defineConfig({
	testDir: "./agent-suites",
	testMatch: "public-regression-pilot/*.spec.ts",
	outputDir: "test-results/agent-test-public-regression-pilot",
	timeout: 240_000,
	retries: 0,
	workers: 1,
	agent: openai({ model: "gpt-5.6-luna", includeGlobalSkills: false, timeoutMs: 90_000 }),
	judge: openai({ model: "gpt-5.6-luna", includeGlobalSkills: false, timeoutMs: 60_000 }),
});
