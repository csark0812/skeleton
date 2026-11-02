import { findRepoRoot, loadConfig } from "../audit/config/load.ts";
import {
	formatReviewBundle,
	largeBundleWarning,
	prepareReview,
	runReviewCommand,
} from "./prepare.ts";

interface ReviewPrepareOptions {
	staged: boolean;
	base?: string;
	paths?: string[];
	json: boolean;
	run: boolean;
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: strict argv parsing enumerates every supported spelling and rejection
export function parseReviewPrepareArgs(argv: string[]): ReviewPrepareOptions {
	const options: ReviewPrepareOptions = { staged: false, json: false, run: false };
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === "--staged") options.staged = true;
		else if (arg === "--json") options.json = true;
		else if (arg === "--run") options.run = true;
		else if (arg === "--base") {
			const value = argv[++i];
			if (!value || value.startsWith("-")) throw new Error("review prepare: --base needs a ref");
			options.base = value;
		} else if (arg?.startsWith("--base=")) {
			options.base = arg.slice("--base=".length);
			if (!options.base) throw new Error("review prepare: --base cannot be empty");
		} else if (arg?.startsWith("--paths=")) {
			options.paths = arg.slice("--paths=".length).split(",").filter(Boolean);
			if (options.paths.length === 0) throw new Error("review prepare: --paths cannot be empty");
		} else throw new Error(`review prepare: unexpected argument ${arg}`);
	}
	if (options.staged && options.base) {
		throw new Error("review prepare: use --staged or --base, not both");
	}
	if (options.json && options.run) {
		throw new Error("review prepare: --run hands text to the reviewer; drop --json");
	}
	return options;
}

/**
 * Print a self-contained review bundle, or pipe it to `[review] command` with `--run`.
 * Human-review paths are repeated on stderr so an agent cannot miss them.
 */
export async function runReviewPrepare(options: ReviewPrepareOptions): Promise<number> {
	const root = findRepoRoot();
	const bundle = await prepareReview({
		root,
		staged: options.staged,
		base: options.base,
		paths: options.paths,
	});
	if (bundle.humanReviewRequired.length > 0) {
		console.error(
			`review prepare: human review required for ${bundle.humanReviewRequired.join(", ")}; an agent review does not count`,
		);
	}
	const text = formatReviewBundle(bundle);
	const warning = largeBundleWarning(bundle, text);
	if (warning) console.error(warning);
	if (options.json) {
		console.log(JSON.stringify(bundle, null, "\t"));
		return 0;
	}
	if (!options.run) {
		console.log(text);
		return 0;
	}
	const command = loadConfig(root).review?.command;
	if (!command) throw new Error("review prepare --run: set [review] command in skeleton.toml");
	return runReviewCommand({ root, command, bundle: text });
}
