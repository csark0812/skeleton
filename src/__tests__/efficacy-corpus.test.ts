import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import {
	parseQualificationCorpus,
	type QualificationCorpus,
} from "../../scripts/efficacy/corpus.ts";

const manifestUrl = new URL(
	"../../agent-suites/broader-openai-v1/qualification-corpus.json",
	import.meta.url,
);
const manifest = () => JSON.parse(readFileSync(manifestUrl, "utf8")) as unknown;

describe("public polyglot qualification corpus", () => {
	it("seals exactly twelve tasks from six public repositories", () => {
		const corpus = parseQualificationCorpus(manifest());
		expect(corpus.version).toBe("broader-openai-v1");
		expect(corpus.status).toBe("sealed");
		expect(corpus.model).toBe("gpt-5.6-luna");
		expect(corpus.repetitions).toBe(10);
		expect(new Set(corpus.tasks.map((task) => task.repository))).toEqual(
			new Set([
				"post-print/agent-spec",
				"expo/expo",
				"honojs/hono",
				"fastapi/fastapi",
				"astral-sh/ruff",
				"biomejs/biome",
			]),
		);
		expect(corpus.tasks.filter((task) => task.tier === "core")).toHaveLength(8);
		expect(corpus.tasks.filter((task) => task.tier === "recovery")).toHaveLength(2);
		expect(corpus.tasks.filter((task) => task.tier === "trivial")).toHaveLength(1);
		expect(corpus.tasks.filter((task) => task.tier === "adoption")).toHaveLength(1);
	});

	it("rejects private or PostPrint application evidence", () => {
		const corpus = parseQualificationCorpus(manifest());
		const privateCorpus: QualificationCorpus = structuredClone(corpus);
		privateCorpus.tasks[0]!.repository = "post-print/applications";
		privateCorpus.tasks[0]!.repositoryUrl = "https://github.com/post-print/applications";
		expect(() => parseQualificationCorpus(privateCorpus)).toThrow("private or forbidden");
	});

	it("rejects mutable refs, incomplete hashes, duplicate task ids, and non-ten-run settings", () => {
		const corpus = parseQualificationCorpus(manifest());
		for (const mutate of [
			(value: QualificationCorpus) => {
				value.tasks[0]!.commit = "main";
			},
			(value: QualificationCorpus) => {
				value.tasks[0]!.promptSha256 = "sha256:pending";
			},
			(value: QualificationCorpus) => {
				value.tasks[1]!.id = value.tasks[0]!.id;
			},
			(value: QualificationCorpus) => {
				(value as { repetitions: number }).repetitions = 5;
			},
		]) {
			const invalid = structuredClone(corpus);
			mutate(invalid);
			expect(() => parseQualificationCorpus(invalid)).toThrow();
		}
	});

	it("requires public upstream evidence and focused commands without secrets or devices", () => {
		const corpus = parseQualificationCorpus(manifest());
		const invalid = structuredClone(corpus);
		invalid.tasks[0]!.upstreamUrl = "";
		expect(() => parseQualificationCorpus(invalid)).toThrow("upstreamUrl");
		const device = structuredClone(corpus);
		device.tasks[1]!.requirements = ["ios-simulator"];
		expect(() => parseQualificationCorpus(device)).toThrow("forbidden requirement");
	});
});
