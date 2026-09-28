import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import {
	parseQualificationCorpus,
	type QualificationCorpus,
	sealQualificationCorpus,
} from "../../scripts/efficacy/corpus.ts";
import { buildV2Corpus } from "../../scripts/efficacy/v2-corpus.ts";

const manifestUrl = new URL(
	"../../agent-suites/broader-openai-v1/qualification-corpus.json",
	import.meta.url,
);
const manifest = () => JSON.parse(readFileSync(manifestUrl, "utf8")) as unknown;

describe("public polyglot qualification corpus", () => {
	it("keeps the committed v2 manifest identical to its reviewed task definitions", () => {
		const committed = parseQualificationCorpus(
			JSON.parse(
				readFileSync(
					new URL(
						"../../agent-suites/broader-openai-v2/qualification-corpus.json",
						import.meta.url,
					),
					"utf8",
				),
			),
		);
		expect(committed).toEqual(buildV2Corpus(committed.sealedAt));
		expect(committed.tasks.filter((task) => task.kind === "discovery")).toHaveLength(4);
		expect(committed.tasks.filter((task) => task.kind === "maintenance")).toHaveLength(4);
	});

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
		const emptyRegression = structuredClone(corpus);
		emptyRegression.tasks[1]!.verifier.verificationCommand = " ";
		expect(() => parseQualificationCorpus(emptyRegression)).toThrow("verificationCommand");
	});

	it("accepts v2 with a pinned local regression and rejects unsafe fixture paths", () => {
		const corpus = structuredClone(parseQualificationCorpus(manifest()));
		corpus.version = "broader-openai-v2";
		for (const item of corpus.tasks) {
			if (item.verifier.kind === "historical-patch")
				item.verifier.verificationCommand = item.nativeTestCommand;
			if (item.verifier.kind === "exact-edit")
				item.verifier.exactEdit = { path: "README.md", from: "old", to: "new" };
		}
		const verifier = corpus.tasks[1]!.verifier;
		verifier.verificationFixture = {
			sourcePath: "agent-suites/broader-openai-v2/verifiers/claude-auth-mode.test.ts",
			destinationPath: "packages/harness/src/__tests__/claude-auth-mode.test.ts",
			sha256: `sha256:${"a".repeat(64)}`,
		};
		verifier.verificationCommand = "bun test hidden.test.ts";
		const valid = sealQualificationCorpus(corpus);
		expect(valid.version).toBe("broader-openai-v2");
		const withoutExactEdit = structuredClone(valid);
		delete withoutExactEdit.tasks.find((item) => item.tier === "trivial")!.verifier.exactEdit;
		expect(() => sealQualificationCorpus(withoutExactEdit)).toThrow("task-defined replacement");
		for (const unsafe of ["../hidden.test.ts", "/private/hidden.test.ts", "..\\hidden.test.ts"]) {
			const invalid = structuredClone(valid);
			invalid.tasks[1]!.verifier.verificationFixture!.destinationPath = unsafe;
			expect(() => sealQualificationCorpus(invalid)).toThrow("invalid local verification fixture");
		}
	});

	it("rejects unsafe or ambiguous task-defined exact edits", () => {
		const corpus = structuredClone(parseQualificationCorpus(manifest()));
		const verifier = corpus.tasks.find((task) => task.tier === "trivial")!.verifier;
		verifier.exactEdit = { path: "../README.md", from: "old", to: "new" };
		expect(() => sealQualificationCorpus(corpus)).toThrow("invalid exact-edit contract");
		verifier.exactEdit.path = "README.md";
		verifier.exactEdit.to = "old";
		expect(() => sealQualificationCorpus(corpus)).toThrow("invalid exact-edit contract");
	});
});
