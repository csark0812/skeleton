import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
	copyFileSync,
	createWriteStream,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";

const MANIFEST = "agent-suites/seeds/review-sessions.json";
const PAIRS_PER_ROUND = "10";
const ROUND_TIMEOUT_MS = "10800000";
const REVIEW_MODEL = "gpt-5.6-luna";
const ROUNDS = [
	{ name: "payments", spec: "review-seeded-defects", nullRound: false },
	{ name: "notifications", spec: "review-notifications", nullRound: false },
	{ name: "real", spec: "review-real-regression", nullRound: false },
	{ name: "heldout", spec: "review-held-out-regression", nullRound: false },
	{ name: "null", spec: "review-seeded-defects", nullRound: true },
];

/** Run one round, teeing its output to a log, and return the execution it recorded. */
function runRound(round: (typeof ROUNDS)[number], day: string): Promise<string> {
	const log = `/private/tmp/review-session-${day}-${process.pid}-${Date.now()}-${round.name}.log`;
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

/**
 * Fingerprint what the server tells Codex about the model, from a home as clean as a run's. Every
 * run fetches this catalog itself and deletes it, so this is the only record of what they got.
 */
function modelCatalogHash(): string {
	const home = mkdtempSync(join(tmpdir(), "skeleton-review-catalog-"));
	try {
		copyFileSync(join(homedir(), ".codex/auth.json"), join(home, "auth.json"));
		const catalog = JSON.parse(
			execFileSync("codex", ["debug", "models"], {
				encoding: "utf8",
				env: { ...process.env, CODEX_HOME: home },
				maxBuffer: 64 * 1024 * 1024,
				stdio: ["ignore", "pipe", "ignore"],
			}),
		);
		const model = catalog.models.find((entry: { slug: string }) => entry.slug === REVIEW_MODEL);
		return createHash("sha256").update(JSON.stringify(model)).digest("hex").slice(0, 12);
	} finally {
		rmSync(home, { recursive: true, force: true });
	}
}

/** The session the reliable comparison froze. Other rounds run only when a study names them. */
const DEFAULT_ROUNDS = ["payments", "notifications", "real", "null"];

type SessionOptions = { rounds: typeof ROUNDS; sessions: number; study: string | null };

/** `--rounds=real,null` picks rounds, `--sessions=3` repeats them, `--study=name` tags the entries. */
function sessionOptions(args: string[]): SessionOptions {
	const value = (name: string) =>
		args.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
	const names = value("rounds")?.split(",") ?? DEFAULT_ROUNDS;
	const rounds = ROUNDS.filter((round) => names.includes(round.name));
	if (rounds.length !== names.length) throw new Error(`Unknown round in ${names.join(",")}`);
	return { rounds, sessions: Number(value("sessions") ?? "1"), study: value("study") ?? null };
}

/** One session. A round marked failed still counts: the report's bars judge its data. */
async function runSession({ rounds, study }: SessionOptions): Promise<void> {
	const day = new Date().toISOString().slice(0, 10);
	const catalogBefore = modelCatalogHash();
	const executions = await Promise.all(rounds.map((round) => runRound(round, day)));
	const entry = Object.fromEntries(rounds.map((round, index) => [round.name, executions[index]]));
	const manifest = JSON.parse(readFileSync(MANIFEST, "utf8"));
	manifest.push({
		confirmatory: true,
		...(study ? { study } : {}),
		day,
		catalogBefore,
		catalogAfter: modelCatalogHash(),
		...entry,
	});
	writeFileSync(MANIFEST, `${JSON.stringify(manifest, null, "\t")}\n`);
	console.log(`Recorded session ${manifest.length} for ${day}.`);
}

const options = sessionOptions(process.argv.slice(2));
for (let session = 0; session < options.sessions; session += 1) await runSession(options);
