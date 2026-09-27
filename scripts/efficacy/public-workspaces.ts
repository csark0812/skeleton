import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	cpSync,
	existsSync,
	lstatSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	readlinkSync,
	realpathSync,
	renameSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative, sep } from "node:path";
import process from "node:process";
import type { QualificationCorpus, QualificationCorpusTask } from "./corpus.ts";
import {
	verifyHistoricalTask,
	verifyKnownUpstreamFix,
	verifyNativeTask,
} from "./public-verification.ts";

export type TreatmentMode = "prepared" | "missing-metadata" | "adoption";

export function workspacePlan(task: QualificationCorpusTask) {
	const treatment: TreatmentMode =
		task.tier === "adoption"
			? "adoption"
			: task.id.includes("missing-metadata")
				? "missing-metadata"
				: "prepared";
	return {
		control: "plain" as const,
		treatment,
		installSkeleton: treatment !== "adoption",
		includeVendorArtifact: treatment === "adoption",
	};
}

export function qualificationPaper(task: QualificationCorpusTask, treatment: boolean) {
	const plan = workspacePlan(task);
	const metadata =
		treatment && plan.treatment !== "missing-metadata" && plan.treatment !== "adoption"
			? `<!-- source-of-truth: ${task.id} qualification ownership -->\n<!-- doc-meta: owner=qualification | last-reviewed=2026-09-27 -->\n<!-- review-deps: paths=${task.verifier.expectedPaths.map(reviewDependencyPattern).join(",")} -->\n\n`
			: "";
	return `${metadata}# Qualification task: ${task.id}\n\nThis public repository task tests whether an agent can find and preserve the durable behavior named in the user request. Existing repository source, tests, and documentation remain authoritative.\n`;
}

function reviewDependencyPattern(path: string) {
	return /(^|\/)[^/]+\.[^/]+$/.test(path) ? path : `${path.replace(/\/$/, "")}/**`;
}

export function publicWorkspacePaths(root: string, task: QualificationCorpusTask) {
	const taskRoot = join(root, ".qualification-cache", "workspaces", task.id);
	return { control: join(taskRoot, "control"), treatment: join(taskRoot, "skeleton") };
}

export function publicAgentWorkspacePaths(root: string, task: QualificationCorpusTask) {
	const taskRoot = join(root, ".qualification-cache", "agent-workspaces", task.id);
	return { control: join(taskRoot, "control"), treatment: join(taskRoot, "skeleton") };
}

/** Keep native build products out of the SDK's sealed copies and snapshots. */
export function qualificationRuntimeEnv(root: string, task: QualificationCorpusTask) {
	const checkoutId = createHash("sha256").update(root).digest("hex").slice(0, 12);
	const nativeRoot = join(tmpdir(), "skeleton-broader-openai-v1", checkoutId, task.id);
	return {
		BUN_INSTALL_CACHE_DIR: join(root, ".qualification-cache", "bun"),
		COREPACK_ENABLE_PROJECT_SPEC: "0",
		COREPACK_HOME: join(root, ".qualification-cache", "corepack"),
		YARN_CACHE_FOLDER: join(root, ".qualification-cache", "yarn"),
		UV_CACHE_DIR: join(root, ".qualification-cache", "uv"),
		UV_PROJECT_ENVIRONMENT: join(nativeRoot, "venv"),
		CARGO_HOME: join(root, ".qualification-cache", "cargo"),
		RUSTUP_HOME: join(root, ".qualification-cache", "rustup"),
		CARGO_TARGET_DIR: join(nativeRoot, "target"),
	};
}

/** A source-equivalent view with generated dependencies linked rather than copied per run. */
export function prepareAgentWorkspace(source: string, target: string) {
	rmSync(target, { recursive: true, force: true });
	const dependencies: string[] = [];
	const danglingLinks: string[] = [];
	cpSync(source, target, {
		recursive: true,
		dereference: true,
		filter: (path) => {
			const parts = relative(source, path).split(sep);
			if (["coverage", ".pdm-build"].includes(parts[0])) return false;
			if (
				parts.some((part) =>
					[
						".git",
						"target",
						".venv",
						"__pycache__",
						".pytest_cache",
						".ruff_cache",
						".swc",
					].includes(part),
				)
			)
				return false;
			if (basename(path) === "node_modules") {
				dependencies.push(relative(source, path));
				return false;
			}
			if (lstatSync(path).isSymbolicLink() && !existsSync(path)) {
				danglingLinks.push(relative(source, path));
				return false;
			}
			return true;
		},
	});
	for (const path of danglingLinks) {
		const materialized = join(target, path);
		mkdirSync(dirname(materialized), { recursive: true });
		writeFileSync(materialized, readlinkSync(join(source, path)));
	}
	for (const path of dependencies) {
		const link = join(target, path);
		mkdirSync(dirname(link), { recursive: true });
		symlinkSync(realpathSync(join(source, path)), link, "junction");
	}
}

/** Fail closed if preparation changes anything beyond the declared intervention surface. */
export function assertPairedAgentWorkspaces(
	paths: { control: string; treatment: string },
	task: QualificationCorpusTask,
) {
	const control = agentFiles(paths.control);
	const treatment = agentFiles(paths.treatment);
	for (const path of new Set([...control.keys(), ...treatment.keys()])) {
		if (interventionPath(path, task)) continue;
		const left = control.get(path);
		const right = treatment.get(path);
		if (!(left && right) || !readFileSync(left).equals(readFileSync(right)))
			throw new Error(
				`${task.id}: agent-visible baseline/treatment difference outside allowlist: ${path}`,
			);
	}
}

function agentFiles(root: string) {
	const files = new Map<string, string>();
	// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Fail-closed recursion distinguishes dependencies, directories, files, and unsupported entries.
	const visit = (directory: string) => {
		for (const entry of readdirSync(directory, { withFileTypes: true })) {
			if (entry.name === "node_modules") continue;
			const path = join(directory, entry.name);
			if (entry.isDirectory()) visit(path);
			else if (entry.isFile()) files.set(relative(root, path).split(sep).join("/"), path);
			else throw new Error(`Agent workspace contains unsupported entry: ${path}`);
		}
	};
	visit(root);
	return files;
}

function interventionPath(path: string, task: QualificationCorpusTask) {
	return (
		path === "AGENTS.md" ||
		path === "skeleton.toml" ||
		path === "package.json" ||
		path === ".pre-commit-config.yaml" ||
		path.startsWith(".skeleton/") ||
		path === `docs/qualification/${task.id}.md` ||
		(task.tier === "adoption" && path === "vendor/skeleton.tgz")
	);
}

export function externalizeNodeModules(
	root: string,
	task: QualificationCorpusTask,
	workspace: string,
) {
	const source = join(workspace, "node_modules");
	const target = join(root, ".qualification-cache", "dependencies", task.id, basename(workspace));
	if (!existsSync(source)) {
		if (!existsSync(target)) return;
		symlinkSync(target, source, "junction");
		return;
	}
	if (lstatSync(source).isSymbolicLink()) {
		if (realpathSync(source) !== realpathSync(target))
			throw new Error(`${task.id}: node_modules points outside its prepared dependency cache.`);
		return;
	}
	// An interrupted earlier preparation may leave the old cache beside a fresh local install.
	if (existsSync(target)) rmSync(target, { recursive: true, force: true });
	mkdirSync(dirname(target), { recursive: true });
	renameSync(source, target);
	symlinkSync(target, source, "junction");
}

export function publicRepositoryCache(root: string, task: QualificationCorpusTask) {
	return join(root, ".qualification-cache", "repositories", task.repository.replace("/", "--"));
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity lint/complexity/noExcessiveLinesPerFunction: Preparation intentionally keeps each sealed task's symmetric workspace lifecycle and verifier preflight together.
export function preparePublicQualification(
	root: string,
	corpus: QualificationCorpus,
	options: { installDependencies?: boolean } = {},
) {
	const artifact = packArtifact(root);
	const prepared: Array<{
		id: string;
		control: string;
		treatment: string;
		agentPaths: { control: string; treatment: string };
		repositoryCache: string;
	}> = [];
	const verifierPreflight: Array<{
		id: string;
		native: boolean;
		red?: boolean;
		green?: boolean;
	}> = [];
	for (const task of corpus.tasks) {
		const repositoryCache = ensureRepository(root, task);
		const paths = publicWorkspacePaths(root, task);
		const agentPaths = publicAgentWorkspacePaths(root, task);
		const packageManagerEnv = qualificationRuntimeEnv(root, task);
		for (const path of Object.values(paths)) {
			ensurePinnedWorktree(repositoryCache, path, task.commit);
			const tree = exec("git", ["-C", path, "rev-parse", "HEAD^{tree}"], root).trim();
			if (tree !== task.tree)
				throw new Error(`${task.id}: expected tree ${task.tree}, received ${tree}.`);
		}
		writeQualificationPaper(paths.control, task, false);
		writeQualificationPaper(paths.treatment, task, true);
		if (options.installDependencies !== false) {
			installRepositoryDependencies(task, paths.control, { root, env: packageManagerEnv });
			installRepositoryDependencies(task, paths.treatment, { root, env: packageManagerEnv });
			prepareNativeWorkspace(task.repository, paths.control, packageManagerEnv);
			prepareNativeWorkspace(task.repository, paths.treatment, packageManagerEnv);
			const native = verifyNativeTask(task, paths.control, { env: packageManagerEnv });
			if (!native.passed)
				throw new Error(
					`${task.id}: focused base test did not pass within ${task.warmTestTimeoutMs}ms: ${native.error ?? native.output}`,
				);
			if (task.verifier.kind === "historical-patch") {
				const red = verifyHistoricalTask(task, paths.control, repositoryCache, {
					env: packageManagerEnv,
				});
				const green = verifyKnownUpstreamFix(task, paths.control, repositoryCache, {
					env: packageManagerEnv,
				});
				if (red.passed || red.error)
					throw new Error(`${task.id}: frozen base did not produce a valid red verifier.`);
				if (!green.passed)
					throw new Error(
						`${task.id}: known upstream fix did not pass: ${green.error ?? green.output}`,
					);
				verifierPreflight.push({ id: task.id, native: true, red: true, green: true });
			} else {
				verifierPreflight.push({ id: task.id, native: true });
			}
		}
		const plan = workspacePlan(task);
		if (plan.includeVendorArtifact) {
			const vendor = join(paths.treatment, "vendor");
			mkdirSync(vendor, { recursive: true });
			cpSync(artifact.tarball, join(vendor, "skeleton.tgz"));
		} else if (plan.installSkeleton) {
			installSkeletonArtifact(root, artifact.tarball, paths.treatment);
			const cli = join(paths.treatment, "node_modules/@csark0812/skeleton/dist/cli.js");
			exec("node", [cli, "init", "--no-skills"], paths.treatment);
			normalizeAgentSpecConfig(task, paths.treatment);
			if (plan.treatment === "prepared") {
				const paper = `docs/qualification/${task.id}.md`;
				exec(
					"node",
					[cli, "audit", "docs", `--paths=${paper}`, "--fix=doc-meta", "--confirm-reviewed"],
					paths.treatment,
				);
			}
			exec("node", [cli, "catalog"], paths.treatment);
		}
		externalizeNodeModules(root, task, paths.control);
		externalizeNodeModules(root, task, paths.treatment);
		prepareAgentWorkspace(paths.control, agentPaths.control);
		prepareAgentWorkspace(paths.treatment, agentPaths.treatment);
		assertPairedAgentWorkspaces(agentPaths, task);
		prepared.push({ id: task.id, ...paths, agentPaths, repositoryCache });
	}
	return { artifact: artifact.metadata, prepared, verifierPreflight };
}

export function ensurePinnedWorktree(repositoryCache: string, path: string, commit: string) {
	if (existsSync(path)) {
		try {
			if (exec("git", ["-C", path, "rev-parse", "HEAD"], repositoryCache).trim() === commit) return;
		} catch {
			// Replace an invalid or incomplete generated workspace below.
		}
		removeWorktree(repositoryCache, path);
	}
	exec(
		"git",
		["-C", repositoryCache, "worktree", "add", "--detach", path, commit],
		repositoryCache,
	);
}

function prepareNativeWorkspace(
	repository: string,
	workspace: string,
	env: Record<string, string>,
) {
	if (repository === "post-print/agent-spec") exec("bun", ["run", "build"], workspace);
	if (repository === "expo/expo") {
		if (existsSync(join(workspace, "pnpm-lock.yaml"))) {
			for (const packageName of [
				"@expo/require-utils",
				"@expo/config",
				"@expo/json-file",
				"@expo/env",
				"@expo/metro-config",
				"expo-modules-autolinking",
			])
				exec("corepack", ["pnpm@10.33.0", "--filter", packageName, "build"], workspace, env);
		} else {
			exec(
				"corepack",
				["yarn@1.22.22", "workspace", "expo-modules-autolinking", "build"],
				workspace,
				env,
			);
		}
	}
}

/** Remove obsolete empty options from the public first-party repo's legacy Skeleton config. */
export function normalizeAgentSpecConfig(task: QualificationCorpusTask, workspace: string) {
	if (task.repository !== "post-print/agent-spec") return false;
	const path = join(workspace, ".skeleton/config.yaml");
	if (!existsSync(path)) return false;
	const before = readFileSync(path, "utf8");
	const after = before.replace(/^[\t ]+(?:banned|retiredSkills):[\t ]*\[\][\t ]*\r?\n/gm, "");
	if (after !== before) writeFileSync(path, after);
	return after !== before;
}

function ensureRepository(root: string, task: QualificationCorpusTask) {
	const target = publicRepositoryCache(root, task);
	if (!existsSync(join(target, ".git"))) {
		mkdirSync(dirname(target), { recursive: true });
		exec("git", ["clone", "--filter=blob:none", "--no-checkout", task.repositoryUrl, target], root);
	}
	const commits = [task.commit, task.verifier.referenceCommit].filter((value): value is string =>
		Boolean(value),
	);
	for (const commit of commits)
		exec("git", ["-C", target, "fetch", "--depth=1", "origin", commit], root);
	return target;
}

function removeWorktree(repositoryCache: string, path: string) {
	if (!existsSync(path)) return;
	try {
		exec("git", ["-C", repositoryCache, "worktree", "remove", "--force", path], repositoryCache);
	} catch {
		rmSync(path, { recursive: true, force: true });
		exec("git", ["-C", repositoryCache, "worktree", "prune"], repositoryCache);
	}
}

function writeQualificationPaper(root: string, task: QualificationCorpusTask, treatment: boolean) {
	const path = join(root, "docs/qualification", `${task.id}.md`);
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, qualificationPaper(task, treatment));
	const fixture = task.verifier.recoveryEvidence?.fixture;
	if (fixture) {
		const fixturePath = join(root, fixture.path);
		mkdirSync(dirname(fixturePath), { recursive: true });
		writeFileSync(fixturePath, fixture.content);
	}
}

function packArtifact(root: string) {
	const destination = join(root, ".qualification-cache", "artifact");
	rmSync(destination, { recursive: true, force: true });
	mkdirSync(destination, { recursive: true });
	const packed = JSON.parse(
		exec("npm", ["pack", "--ignore-scripts", "--json", "--pack-destination", destination], root, {
			npm_config_cache: join(root, ".qualification-cache", "npm"),
		}),
	)[0];
	return { tarball: join(destination, packed.filename), metadata: packed };
}

function installSkeletonArtifact(root: string, tarball: string, workspace: string) {
	const target = join(workspace, "node_modules/@csark0812/skeleton");
	rmSync(target, { recursive: true, force: true });
	mkdirSync(target, { recursive: true });
	exec("tar", ["-xzf", tarball, "--strip-components=1", "-C", target], workspace);
	const dependencies = Object.keys(
		JSON.parse(readFileSync(join(root, "package.json"), "utf8")).dependencies ?? {},
	);
	const copied = new Set<string>();
	for (const dependency of dependencies) copyDependency(root, workspace, dependency, copied);
	linkSkeletonExecutable(workspace);
}

export function linkSkeletonExecutable(workspace: string) {
	const bin = join(workspace, "node_modules/.bin");
	mkdirSync(bin, { recursive: true });
	const executable = join(bin, "skeleton");
	rmSync(executable, { force: true });
	symlinkSync("../@csark0812/skeleton/dist/cli.js", executable);
}

// biome-ignore lint/complexity/useMaxParams: Recursive dependency copying needs both roots, the current package, and cycle state.
function copyDependency(root: string, workspace: string, name: string, copied: Set<string>) {
	if (copied.has(name)) return;
	copied.add(name);
	const source = join(root, "node_modules", name);
	const manifest = JSON.parse(readFileSync(join(source, "package.json"), "utf8"));
	cpSync(source, join(workspace, "node_modules", name), { recursive: true, dereference: true });
	for (const dependency of Object.keys(manifest.dependencies ?? {}))
		copyDependency(root, workspace, dependency, copied);
}

export function installRepositoryDependencies(
	task: QualificationCorpusTask,
	workspace: string,
	options: { root: string; env: Record<string, string> },
) {
	const { root, env } = options;
	const modules = join(workspace, "node_modules");
	if (existsSync(modules) && lstatSync(modules).isSymbolicLink()) {
		const prepared = join(
			root,
			".qualification-cache",
			"dependencies",
			task.id,
			basename(workspace),
		);
		if (realpathSync(modules) !== realpathSync(prepared))
			throw new Error(`${task.id}: node_modules is not the prepared dependency cache.`);
		return;
	}
	const repository = task.repository;
	const commands: Record<string, [string, string[]]> = {
		"post-print/agent-spec": ["bun", ["install", "--no-save"]],
		"expo/expo": expoInstallCommand(workspace),
		"honojs/hono": ["bun", ["install", "--no-save"]],
		"fastapi/fastapi": ["uv", ["sync", "--frozen"]],
		"astral-sh/ruff": ["cargo", ["fetch", "--locked"]],
		"biomejs/biome": ["cargo", ["fetch", "--locked"]],
	};
	const command = commands[repository];
	if (!command) throw new Error(`No dependency preparation command for ${repository}.`);
	const lockfile = join(workspace, lockfileForRepository(repository, workspace));
	const originalLockfile = readFileSync(lockfile);
	exec(command[0], command[1], workspace, env);
	if (!readFileSync(lockfile).equals(originalLockfile))
		throw new Error(`${repository}: dependency installation modified its frozen lockfile.`);
}

export function expoInstallCommand(workspace: string): [string, string[]] {
	return [
		"corepack",
		existsSync(join(workspace, "pnpm-lock.yaml"))
			? ["pnpm@10.33.0", "install", "--frozen-lockfile", "--ignore-scripts"]
			: ["yarn@1.22.22", "install", "--frozen-lockfile", "--ignore-scripts", "--non-interactive"],
	];
}

export function lockfileForRepository(repository: string, workspace: string) {
	const lockfiles: Record<string, string> = {
		"post-print/agent-spec": "bun.lock",
		"honojs/hono": "bun.lock",
		"fastapi/fastapi": "uv.lock",
		"astral-sh/ruff": "Cargo.lock",
		"biomejs/biome": "Cargo.lock",
	};
	const lockfile =
		repository === "expo/expo"
			? existsSync(join(workspace, "pnpm-lock.yaml"))
				? "pnpm-lock.yaml"
				: "yarn.lock"
			: lockfiles[repository];
	if (!lockfile) throw new Error(`No dependency lockfile for ${repository}.`);
	return lockfile;
}

// biome-ignore lint/complexity/useMaxParams: This narrow process adapter keeps command, arguments, location, and optional environment visible.
function exec(command: string, args: string[], cwd: string, extraEnv: Record<string, string> = {}) {
	return execFileSync(command, args, {
		cwd,
		encoding: "utf8",
		stdio: ["ignore", "pipe", "inherit"],
		env: { ...process.env, ...extraEnv },
	});
}
