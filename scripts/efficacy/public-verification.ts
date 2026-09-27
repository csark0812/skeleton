import { execFileSync, spawnSync } from "node:child_process";
import {
	cpSync,
	existsSync,
	lstatSync,
	mkdirSync,
	mkdtempSync,
	realpathSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import process from "node:process";
import type { QualificationCorpusTask } from "./corpus.ts";

export type PublicVerification = { passed: boolean; output: string; error?: string };
type VerificationOptions = {
	env?: Record<string, string>;
	/** Prewarmed dependencies are outside SDK snapshots. */
	dependencyWorkspace?: string;
};

export function verifyNativeTask(
	task: QualificationCorpusTask,
	finalWorkspace: string,
	options: VerificationOptions = {},
): PublicVerification {
	if (!options.dependencyWorkspace) return runNativeCommand(task, finalWorkspace, options.env);
	const root = mkdtempSync(join(tmpdir(), "skeleton-public-native-"));
	const workspace = join(root, "workspace");
	try {
		cpSync(finalWorkspace, workspace, { recursive: true, dereference: true });
		for (const dependencyRoot of dependencyRootsFor(task))
			linkDependencyRoot(options.dependencyWorkspace, workspace, dependencyRoot);
		prepareVerificationRuntime(task, workspace, options.env);
		return runNativeCommand(task, workspace, options.env);
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
	const verificationPaths = task.verifier.verificationPaths!;
	const root = mkdtempSync(join(tmpdir(), "skeleton-public-verification-"));
	const workspace = join(root, "workspace");
	try {
		if (existsSync(join(finalWorkspace, ".git"))) {
			execFileSync("git", ["clone", "-q", "--no-hardlinks", finalWorkspace, workspace]);
			applyFinalChanges(finalWorkspace, workspace, root);
		} else {
			cpSync(finalWorkspace, workspace, { recursive: true, dereference: true });
		}
		for (const path of verificationPaths) {
			const contents = execFileSync("git", ["-C", repositoryCache, "show", `${reference}:${path}`]);
			const target = join(workspace, path);
			mkdirSync(dirname(target), { recursive: true });
			writeFileSync(target, contents);
		}
		for (const dependencyRoot of dependencyRootsFor(task))
			linkDependencyRoot(options.dependencyWorkspace ?? finalWorkspace, workspace, dependencyRoot);
		prepareVerificationRuntime(task, workspace, options.env);
		return runNativeCommand(task, workspace, options.env);
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

function runNativeCommand(
	task: QualificationCorpusTask,
	workspace: string,
	env: Record<string, string> = {},
): PublicVerification {
	const result = spawnSync(task.nativeTestCommand, {
		cwd: workspace,
		shell: true,
		encoding: "utf8",
		timeout: task.warmTestTimeoutMs,
		env: { ...process.env, CI: "1", ...env },
	});
	const output = [result.stdout, result.stderr].filter(Boolean).join("\n");
	return result.error
		? { passed: false, output, error: result.error.message }
		: { passed: result.status === 0, output };
}

function dependencyRootsFor(task: QualificationCorpusTask) {
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
	execFileSync("uv", ["sync", "--frozen"], {
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
		return verifyHistoricalTask(task, workspace, repositoryCache, options);
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
	const resolved = lstatSync(source).isSymbolicLink() ? realpathSync(source) : source;
	symlinkSync(resolved, target, "junction");
}
