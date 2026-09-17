/** Frozen task provenance. These commits and fixes never enter an agent workspace. */
export const HISTORY_TASKS = [
	{
		name: "deleted-file",
		scenario: "fix-deleted-file-validation",
		fix: "b05c1a795d32eb776ed57cb4e0d9cf72eaae7b24",
		source: "src/validate/changed.ts",
		doc: "docs/developer/validation.md",
		tests: ["src/__tests__/cli/validate-hook.test.ts"],
	},
	{
		name: "production-javascript",
		scenario: "fix-production-javascript-coverage",
		fix: "a202aad7e0b65ae0198a3bd911432edec432f033",
		source: "src/audit/core/review-coverage.ts",
		doc: "docs/developer/config.md",
		tests: [
			"src/audit/__tests__/review-coverage.test.ts",
			"src/__tests__/cli/validate-hook.test.ts",
		],
	},
] as const;

export const SHARED_GUIDANCE = `# Agent entry

Inspect the repository before answering. Treat source code as implemented behavior, not proof of deployment.
Keep focused tests and relevant documentation accurate when changing code.
Verify changes with the focused tests. Dependencies are already installed.
`;
