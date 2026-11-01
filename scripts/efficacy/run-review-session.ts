import { spawn } from "node:child_process";
import { createWriteStream, readdirSync, readFileSync, writeFileSync } from "node:fs";
import process from "node:process";

const MANIFEST = "agent-suites/seeds/review-sessions.json";
const PAIRS_PER_ROUND = "10";
const ROUND_TIMEOUT_MS = "10800000";
const ROUNDS = [
	{ name: "payments", spec: "review-seeded-defects", nullRound: false },
	{ name: "notifications", spec: "review-notifications", nullRound: false },
	{ name: "real", spec: "review-real-regression", nullRound: false },
	{ name: "null", spec: "review-seeded-defects", nullRound: true },
];

/** Run one round, teeing its output to a log, and return the execution it recorded. */
function runRound(round: (typeof ROUNDS)[number], day: string): Promise<string> {
	const log = `/private/tmp/review-session-${day}-${process.pid}-${round.name}.log`;
	console.log(`${round.name}: ${log}`);
	const stream = createWriteStream(log);
	const child = spawn(
		"node_modules/.bin/agent-test",
		[
			"test",
			`does-skeleton-help/${round.spec}.spec.ts`,
			"--config=agent-test.matrix.config.ts",
			"--project=openai",
			`--timeout=${ROUND_TIMEOUT_MS}`,
		],
		{
			env: {
				...process.env,
				SKELETON_EFFICACY_RUNS: PAIRS_PER_ROUND,
				SKELETON_REVIEW_NULL: round.nullRound ? "1" : "",
			},
		},
	);
	let output = "";
	for (const source of [child.stdout, child.stderr])
		source.on("data", (chunk) => {
			output += chunk;
			stream.write(chunk);
		});
	return new Promise((resolve, reject) => {
		child.on("close", () => {
			stream.end();
			const short = /View run ([0-9a-f]{8})/.exec(output)?.[1];
			const execution = readdirSync(".agent-test/executions").find((id) =>
				id.startsWith(short ?? "-"),
			);
			if (execution) resolve(execution);
			else reject(new Error(`${round.name} recorded no execution; see ${log}`));
		});
	});
}

/** One confirmatory session. A round marked failed still counts: the report's bars judge its data. */
async function main(): Promise<void> {
	const day = new Date().toISOString().slice(0, 10);
	const executions = await Promise.all(ROUNDS.map((round) => runRound(round, day)));
	const entry = Object.fromEntries(ROUNDS.map((round, index) => [round.name, executions[index]]));
	const manifest = JSON.parse(readFileSync(MANIFEST, "utf8"));
	manifest.push({ confirmatory: true, day, ...entry });
	writeFileSync(MANIFEST, `${JSON.stringify(manifest, null, "\t")}\n`);
	console.log(`Recorded session ${manifest.length} for ${day}.`);
}

await main();
