import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import process from "node:process";
import { fileURLToPath } from "node:url";

const values = { host: "openai", scenario: "", runs: 1 };
for (let index = 2; index < process.argv.length; index += 2) {
	const flag = process.argv[index];
	const value = process.argv[index + 1];
	if (!(value && ["--host", "--scenario", "--runs"].includes(flag)))
		throw new Error("Use --host <name>, --scenario <name>, or --runs <positive integer>.");
	if (flag === "--host") values.host = value;
	else if (flag === "--scenario") values.scenario = value;
	else values.runs = Number(value);
}
if (!["cursor", "claude", "openai", "all"].includes(values.host))
	throw new Error("Use --host cursor, claude, openai, or all.");
if (!Number.isInteger(values.runs) || values.runs < 1)
	throw new Error("Use --runs <positive integer>.");
const suitePath = values.scenario
	? `does-skeleton-help/${values.scenario}.spec.ts`
	: "does-skeleton-help";
if (
	values.scenario &&
	!(
		/^[a-z0-9-]+$/.test(values.scenario) &&
		existsSync(new URL(`../agent-suites/${suitePath}`, import.meta.url))
	)
)
	throw new Error(`Unknown scenario: ${values.scenario}`);
const args = ["test", suitePath, "--config=agent-test.matrix.config.ts"];
if (values.host !== "all") args.push(`--project=${values.host}`);
const result = spawnSync(
	fileURLToPath(new URL("../node_modules/.bin/agent-test", import.meta.url)),
	args,
	{
		stdio: "inherit",
		env: { ...process.env, SKELETON_EFFICACY_RUNS: String(values.runs) },
	},
);
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
