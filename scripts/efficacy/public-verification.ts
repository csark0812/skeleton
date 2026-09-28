import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	cpSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import type { QualificationCorpusTask } from "./corpus.ts";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));

export type PublicVerification = { passed: boolean; output: string; error?: string };
type VerificationOptions = {
	env?: Record<string, string>;
	/** Prewarmed dependencies are outside SDK snapshots. */
	dependencyWorkspace?: string;
};

/** Check one requested replacement against immutable before/after files. */
export function verifyExactEdit(
	task: QualificationCorpusTask,
	workspace: { initial: string; final: string; changedPaths: string[] },
): PublicVerification {
	const edit = task.verifier.exactEdit;
	if (task.verifier.kind !== "exact-edit" || !edit)
		return { passed: false, output: "", error: `${task.id}: exact-edit contract is missing.` };
	const beforePath = join(workspace.initial, edit.path);
	const afterPath = join(workspace.final, edit.path);
	if (!(existsSync(beforePath) && existsSync(afterPath)))
		return { passed: false, output: "Requested file is missing." };
	const before = readFileSync(beforePath, "utf8");
	const after = readFileSync(afterPath, "utf8");
	const oneOccurrence = before.split(edit.from).length === 2;
	const oneChangedPath =
		workspace.changedPaths.length === 1 && workspace.changedPaths[0] === edit.path;
	const passed = oneOccurrence && oneChangedPath && after === before.replace(edit.from, edit.to);
	return {
		passed,
		output: passed
			? "The sole changed file contains exactly the requested replacement."
			: "The edit changed another path, lacks a unique source phrase, or differs beyond the replacement.",
	};
}

export function verifyNativeTask(
	task: QualificationCorpusTask,
	finalWorkspace: string,
	options: VerificationOptions = {},
): PublicVerification {
	if (!options.dependencyWorkspace)
		return runNativeCommand(task, finalWorkspace, { env: options.env });
	const root = mkdtempSync(join(tmpdir(), "skeleton-public-native-"));
	const workspace = join(root, "workspace");
	try {
		cpSync(finalWorkspace, workspace, { recursive: true, dereference: true });
		for (const dependencyRoot of dependencyRootsFor(task))
			linkDependencyRoot(options.dependencyWorkspace, workspace, dependencyRoot);
		prepareVerificationRuntime(task, workspace, options.env);
		return runNativeCommand(task, workspace, { env: options.env });
	} catch (error) {
		return {
			passed: false,
			output: "",
			error: error instanceof Error ? error.message : String(error),
		};
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
}

/** Exercise the public report-out CLI contract without importing upstream implementation helpers. */
// biome-ignore lint/complexity/noExcessiveLinesPerFunction: Four public CLI cases share one isolated workspace and artifact lifecycle.
export function verifyReportOutBehavior(
	finalWorkspace: string,
	dependencyWorkspace: string,
): PublicVerification {
	const root = mkdtempSync(join(tmpdir(), "skeleton-report-out-verification-"));
	const workspace = join(root, "workspace");
	const output: string[] = [];
	try {
		cpSync(finalWorkspace, workspace, { recursive: true, dereference: true });
		linkDependencyRoot(dependencyWorkspace, workspace, "node_modules");
		const exactFile = join(root, "exact", "custom.html");
		const directory = join(root, "collection");
		const disabled = join(root, "disabled");
		const comparison = join(root, "comparison");
		const override = join(root, "override");
		output.push(runReportOutCli(workspace, ["--report-out", exactFile]));
		requireArtifact(exactFile, "Exact .html path did not produce the requested HTML report.");
		forbidArtifact(
			join(root, "exact", "smoke.suite-report.json"),
			"Exact file collected suite JSON.",
		);
		output.push(runReportOutCli(workspace, ["--report-out", directory]));
		const suiteReport = join(directory, "smoke.suite-report.json");
		requireArtifact(join(directory, "report.html"), "Directory form omitted HTML report.");
		requireArtifact(suiteReport, "Directory form omitted suite JSON report.");
		output.push(runReportOutCli(workspace, ["--report-out", disabled, "--no-html-report"]));
		forbidArtifact(join(disabled, "report.html"), "--no-html-report was overridden.");
		output.push(
			runReportOutCli(workspace, [
				"compare",
				"--a",
				suiteReport,
				"--b",
				suiteReport,
				"--report-out",
				comparison,
				"--out-dir",
				override,
			]),
		);
		requireArtifact(
			join(override, "compare-report.json"),
			"--out-dir did not select comparison output.",
		);
		forbidArtifact(comparison, "--report-out overrode --out-dir for comparison output.");
		return { passed: true, output: output.join("\n") };
	} catch (error) {
		return {
			passed: false,
			output: output.join("\n"),
			error: error instanceof Error ? error.message : String(error),
		};
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
}

function runReportOutCli(workspace: string, args: string[]): string {
	const mode =
		args[0] === "compare"
			? args
			: ["--suites-dir", "packages/test/fixtures", "--suite", "smoke", ...args];
	const result = spawnSync("bun", ["packages/test/src/cli.ts", ...mode], {
		cwd: workspace,
		encoding: "utf8",
		timeout: 60_000,
		env: { ...process.env, CI: "1" },
	});
	if (result.error || result.status !== 0)
		throw new Error(
			result.error?.message ??
				`Report-out replay exited ${result.status}: ${result.stderr ?? result.stdout}`,
		);
	return `${result.stdout ?? ""}${result.stderr ?? ""}`;
}

function requireArtifact(path: string, error: string) {
	if (!existsSync(path)) throw new Error(error);
}

function forbidArtifact(path: string, error: string) {
	if (existsSync(path)) throw new Error(error);
}

/** Run upstream regression files from the hidden reference commit against final agent code. */
// biome-ignore lint/complexity/useMaxParams: Repository, base, and hidden-regression paths remain explicit verifier inputs.
export function verifyHistoricalTask(
	task: QualificationCorpusTask,
	finalWorkspace: string,
	repositoryCache: string,
	options: VerificationOptions = {},
): PublicVerification {
	if (task.verifier.kind !== "historical-patch")
		return { passed: false, output: "", error: `${task.id} is not a historical-patch task.` };
	const reference = task.verifier.referenceCommit!;
	const verificationPaths = task.verifier.verificationPaths ?? [];
	const root = mkdtempSync(join(tmpdir(), "skeleton-public-verification-"));
	const workspace = join(root, "workspace");
	try {
		copyFinalWorkspace(finalWorkspace, workspace, root);
		for (const path of verificationPaths) {
			const contents = execFileSync("git", ["-C", repositoryCache, "show", `${reference}:${path}`]);
			const target = join(workspace, path);
			mkdirSync(dirname(target), { recursive: true });
			writeFileSync(target, contents);
		}
		writeLocalVerifierFixture(task, workspace);
		for (const dependencyRoot of dependencyRootsFor(task))
			linkDependencyRoot(options.dependencyWorkspace ?? finalWorkspace, workspace, dependencyRoot);
		prepareVerificationRuntime(task, workspace, options.env);
		return runNativeCommand(task, workspace, {
			env: options.env,
			command: task.verifier.verificationCommand,
		});
	} catch (error) {
		return {
			passed: false,
			output: "",
			error: error instanceof Error ? error.message : String(error),
		};
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
}

function copyFinalWorkspace(finalWorkspace: string, workspace: string, root: string) {
	if (!existsSync(join(finalWorkspace, ".git"))) {
		cpSync(finalWorkspace, workspace, { recursive: true, dereference: true });
		return;
	}
	execFileSync("git", ["clone", "-q", "--no-hardlinks", finalWorkspace, workspace]);
	applyFinalChanges(finalWorkspace, workspace, root);
}

function writeLocalVerifierFixture(task: QualificationCorpusTask, workspace: string) {
	const fixture = task.verifier.verificationFixture;
	if (!fixture) return;
	const contents = readFileSync(join(ROOT, fixture.sourcePath));
	const digest = createHash("sha256").update(contents).digest("hex");
	if (`sha256:${digest}` !== fixture.sha256)
		throw new Error(`${task.id}: local verifier hash changed after sealing.`);
	const target = join(workspace, fixture.destinationPath);
	mkdirSync(dirname(target), { recursive: true });
	writeFileSync(target, contents);
}

function runNativeCommand(
	task: QualificationCorpusTask,
	workspace: string,
	options: { env?: Record<string, string>; command?: string } = {},
): PublicVerification {
	const result = spawnSync(options.command ?? task.nativeTestCommand, {
		cwd: workspace,
		shell: true,
		encoding: "utf8",
		timeout: task.warmTestTimeoutMs,
		env: { ...process.env, CI: "1", ...options.env },
	});
	const output = [result.stdout, result.stderr].filter(Boolean).join("\n");
	return result.error
		? { passed: false, output, error: result.error.message }
		: { passed: result.status === 0, output };
}

function dependencyRootsFor(task: QualificationCorpusTask) {
	if (task.repository === "expo/expo")
		return ["node_modules", "packages/@expo/cli/node_modules", "packages/expo-doctor/node_modules"];
	return task.repository === "fastapi/fastapi"
		? ["node_modules", "target"]
		: ["node_modules", ".venv", "target"];
}

function prepareVerificationRuntime(
	task: QualificationCorpusTask,
	workspace: string,
	env: Record<string, string> = {},
) {
	if (task.repository !== "fastapi/fastapi") return;
	execFileSync("uv", ["sync", "--frozen", "--offline"], {
		cwd: workspace,
		encoding: "utf8",
		stdio: ["ignore", "pipe", "inherit"],
		env: { ...process.env, ...env },
	});
}

/** Apply the complete public upstream fix, then prove the hidden regression turns green. */
// biome-ignore lint/complexity/useMaxParams: Repository, base, and hidden-regression paths remain explicit verifier inputs.
export function verifyKnownUpstreamFix(
	task: QualificationCorpusTask,
	baseWorkspace: string,
	repositoryCache: string,
	options: { env?: Record<string, string> } = {},
): PublicVerification {
	if (task.verifier.kind !== "historical-patch")
		return { passed: false, output: "", error: `${task.id} is not a historical-patch task.` };
	const root = mkdtempSync(join(tmpdir(), "skeleton-public-reference-"));
	const workspace = join(root, "workspace");
	try {
		execFileSync("git", ["clone", "-q", "--no-hardlinks", baseWorkspace, workspace]);
		const patch = execFileSync("git", [
			"-C",
			repositoryCache,
			"diff",
			"--binary",
			task.commit,
			task.verifier.referenceCommit!,
		]);
		const patchPath = join(root, "upstream.patch");
		writeFileSync(patchPath, patch);
		execFileSync("git", ["-C", workspace, "apply", "--binary", patchPath]);
		for (const dependencyRoot of dependencyRootsFor(task))
			linkDependencyRoot(baseWorkspace, workspace, dependencyRoot);
		return verifyHistoricalTask(task, workspace, repositoryCache, {
			...options,
			dependencyWorkspace: baseWorkspace,
		});
	} catch (error) {
		return {
			passed: false,
			output: "",
			error: error instanceof Error ? error.message : String(error),
		};
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
}

function applyFinalChanges(finalWorkspace: string, workspace: string, tempRoot: string) {
	const diff = execFileSync("git", ["-C", finalWorkspace, "diff", "--binary", "HEAD"]);
	if (diff.length) {
		const patch = join(tempRoot, "agent.patch");
		writeFileSync(patch, diff);
		execFileSync("git", ["-C", workspace, "apply", "--binary", patch]);
	}
	const untracked = execFileSync(
		"git",
		["-C", finalWorkspace, "ls-files", "--others", "--exclude-standard", "-z"],
		{ encoding: "utf8" },
	)
		.split("\0")
		.filter(Boolean);
	for (const path of untracked) {
		if (path.split("/").some((part) => ["node_modules", ".venv", "target"].includes(part)))
			continue;
		const source = join(finalWorkspace, path);
		const target = join(workspace, path);
		mkdirSync(dirname(target), { recursive: true });
		cpSync(source, target, { recursive: true, dereference: true });
	}
}

function linkDependencyRoot(sourceRoot: string, targetRoot: string, relative: string) {
	const source = join(sourceRoot, relative);
	const target = join(targetRoot, relative);
	if (!existsSync(source) || existsSync(target)) return;
	mkdirSync(dirname(target), { recursive: true });
	const resolved = realpathSync(source);
	symlinkSync(resolved, target, "junction");
}
