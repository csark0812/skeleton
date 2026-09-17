import { fileURLToPath } from "node:url";
import { customAgent } from "@post-print/agent-harness";
import { defineConfig } from "@post-print/agent-test";

const offline = customAgent({
	adapter: fileURLToPath(new URL("./tests/sdk-contracts/adapter.mjs", import.meta.url)),
	options: {},
});
export default defineConfig({
	testDir: ".",
	testMatch: [
		"tests/sdk-contracts/*.spec.ts",
		"agent-suites/does-skeleton-help/outdated-billing-docs.spec.ts",
		"agent-suites/does-skeleton-help/recover-truncated-context.spec.ts",
		"agent-suites/does-skeleton-help/recover-missing-metadata.spec.ts",
		"agent-suites/does-skeleton-help/simple-edit-overhead.spec.ts",
	],
	outputDir: "test-results/sdk-contracts",
	timeout: 30_000,
	workers: 1,
	retries: 0,
	agent: offline,
	judge: offline,
});
