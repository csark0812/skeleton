import { existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

/** Reserve the one-shot output namespace without replacing any earlier attempt. */
export function reserveQualificationRun(resultRoot: string, evidencePath: string) {
	if (existsSync(resultRoot))
		throw new Error(`Qualification results already exist at ${resultRoot}; refusing a rerun.`);
	if (existsSync(evidencePath))
		throw new Error(
			`Qualification evidence already exists at ${evidencePath}; refusing to overwrite it.`,
		);
	mkdirSync(dirname(resultRoot), { recursive: true });
	// Non-recursive creation is the atomic reservation if two runners start together.
	mkdirSync(resultRoot);
}
