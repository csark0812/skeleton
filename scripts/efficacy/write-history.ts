import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { attestDocuments } from "../../src/audit/core/review-proof.ts";
import { HISTORY_TASKS, SHARED_GUIDANCE } from "./history.ts";

const ROOT = join(import.meta.dir, "../..");

function write(root: string, path: string, text: string): void {
	mkdirSync(dirname(join(root, path)), { recursive: true });
	writeFileSync(join(root, path), text);
}

function historicalFiles(root: string): string[] {
	return readdirSync(root, { recursive: true, withFileTypes: true })
		.filter((entry) => entry.isFile())
		.map((entry) => join(entry.parentPath, entry.name).slice(root.length + 1))
		.filter(
			(path) =>
				!(path.includes("/__tests__/") || path.includes("/fixtures/") || path.endsWith(".test.ts")),
		);
}

function copyHistory(
	task: (typeof HISTORY_TASKS)[number],
	root: string,
	options: { skeleton: boolean; archived: string },
): void {
	for (const path of historicalFiles(options.archived)) {
		let contents = readFileSync(join(options.archived, path), "utf8");
		if (path.endsWith(".md")) {
			contents = contents.replace(
				/<!--(?: source-of-truth:| doc-meta:| review-deps:)[\s\S]*?-->\n*/g,
				"",
			);
			if (options.skeleton && path === task.doc)
				contents = `<!-- source-of-truth: ${task.name} behavior -->\n<!-- doc-meta: owner=eng | last-reviewed=2026-09-16 -->\n<!-- review-deps: paths=${task.source} -->\n\n${contents}`;
		}
		write(root, path, contents);
	}
	// Regression tests specify required behavior, not the reference implementation.
	for (const path of task.tests)
		write(root, path, readFileSync(join(options.archived, path), "utf8"));
	write(root, "AGENTS.md", SHARED_GUIDANCE);
	write(
		root,
		"README.md",
		"# Repository maintenance task\n\nImplementation is under src/. Documentation is under docs/. Run `bun test ./src` to check behavior.\n",
	);
	write(
		root,
		"package.json",
		JSON.stringify(
			{
				name: "maintenance-task",
				private: true,
				type: "module",
				scripts: { test: "bun test ./src" },
			},
			null,
			"\t",
		) + "\n",
	);
}

function prepare(task: (typeof HISTORY_TASKS)[number], side: string, archived: string): void {
	const root = join(ROOT, "tests/fixtures/efficacy/history", task.name, side);
	rmSync(root, { recursive: true, force: true });
	const skeleton = side === "skeleton";
	copyHistory(task, root, { skeleton, archived });
	if (!skeleton) return;
	write(
		root,
		"skeleton.toml",
		`daysUntilStale = 365\n[scan]\ninclude = ["${task.doc}"]\nexclude = []\n[reviewProof]\nmode = "hash"\n[reviewCoverage]\ninclude = ["${task.source}"]\n[deny]\npaths = []\n`,
	);
	attestDocuments({ root, paths: [task.doc], reviewedAt: "2026-09-16" });
}

const archives = join(ROOT, "agent-suites/history");
const provenance = JSON.parse(readFileSync(join(archives, "provenance.json"), "utf8")) as Array<{
	name: string;
	files: Record<string, string>;
}>;
for (const record of provenance) {
	for (const [file, expected] of Object.entries(record.files)) {
		const actual = createHash("sha256")
			.update(readFileSync(join(archives, file)))
			.digest("hex");
		if (actual !== expected) throw new Error(`Historical fixture checksum mismatch: ${file}`);
	}
}
for (const task of HISTORY_TASKS) {
	const archived = mkdtempSync(join(tmpdir(), "skeleton-history-"));
	try {
		for (const suffix of ["before", "tests"])
			execFileSync("tar", [
				"-xzf",
				join(archives, `${task.name}-${suffix}.tar.gz`),
				"-C",
				archived,
			]);
		for (const side of ["control", "skeleton"]) prepare(task, side, archived);
	} finally {
		rmSync(archived, { recursive: true, force: true });
	}
}
console.log(
	"Prepared two historical tasks with the same source and regression tests on both sides.",
);
