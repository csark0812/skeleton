import { openai } from "@post-print/agent-harness";
import { defineConfig } from "@post-print/agent-test";

export default defineConfig({
	testDir: "./agent-suites",
	testMatch: "broader-openai-v2/*.spec.ts",
	outputDir: "test-results/agent-test-broader-v2",
	timeout: 3_600_000,
	retries: 0,
	workers: 1,
	agent: openai({ model: "gpt-5.6-luna", includeGlobalSkills: false }),
	judge: openai({ model: "gpt-5.6-luna", includeGlobalSkills: false }),
});
