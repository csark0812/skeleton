import { readFileSync, writeFileSync } from "node:fs";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { sealQualificationCorpus } from "./efficacy/corpus.ts";

const path = fileURLToPath(
	new URL("../agent-suites/broader-openai-v1/qualification-corpus.json", import.meta.url),
);
const corpus = sealQualificationCorpus(JSON.parse(readFileSync(path, "utf8")));
if (process.argv.includes("--write")) {
	writeFileSync(path, `${JSON.stringify(corpus, null, "\t")}\n`);
	console.log(`sealed ${corpus.tasks.length} public qualification tasks`);
} else {
	console.log(`verified ${corpus.tasks.length} public qualification tasks`);
}
