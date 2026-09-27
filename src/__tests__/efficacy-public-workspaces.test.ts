import { describe, expect, it } from "bun:test";
import { execFileSync } from "node:child_process";
import {
	existsSync,
	lstatSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	readlinkSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { QualificationCorpusTask } from "../../scripts/efficacy/corpus.ts";
import {
	assertPairedAgentWorkspaces,
	ensurePinnedWorktree,
	expoInstallCommand,
	externalizeNodeModules,
	linkSkeletonExecutable,
	lockfileForRepository,
	normalizeAgentSpecConfig,
	prepareAgentWorkspace,
	publicAgentWorkspacePaths,
	qualificationPaper,
	qualificationRuntimeEnv,
	workspacePlan,
} from "../../scripts/efficacy/public-workspaces.ts";

const task = (tier: QualificationCorpusTask["tier"]): QualificationCorpusTask => ({
	id: `example-${tier}`,
	repository: "public/example",
	repositoryUrl: "https://github.com/public/example",
	commit: "1".repeat(40),
	tree: "2".repeat(40),
	license: "MIT",
	upstreamUrl: "https://github.com/public/example/commit/1",
	selectedBy: "test",
	tier,
	kind: tier === "core" ? "discovery" : "guardrail",
	prompt: "Find the public example ownership boundary and verify it.",
	promptSha256: `sha256:${"3".repeat(64)}`,
	verifier: {
		kind: tier === "adoption" ? "adoption" : "judge",
		requirements: ["Identify the owner."],
		expectedPaths: ["src/owner.ts", "tests/owner.test.ts"],
	},
	verifierSha256: `sha256:${"4".repeat(64)}`,
	nativeTestCommand: "bun test tests/owner.test.ts",
	warmTestTimeoutMs: 30_000,
	requirements: ["bun"],
});

const plain = (value: string) => value.replace(/<!--[\s\S]*?-->\s*/g, "").trim();

describe("public qualification workspace preparation", () => {
	it("creates a lean SDK source with dependencies linked and other symlinks materialized", () => {
		const root = mkdtempSync(join(tmpdir(), "skeleton-lean-workspace-test-"));
		try {
			const source = join(root, "prepared");
			const target = join(root, "agent");
			mkdirSync(source);
			writeFileSync(join(source, "README.md"), "public source\n");
			symlinkSync("README.md", join(source, "linked-readme.md"));
			symlinkSync("missing-fixture", join(source, "dangling-fixture"));
			mkdirSync(join(source, "coverage"));
			for (const excluded of [
				".git",
				".venv",
				"target",
				"node_modules",
				"__pycache__",
				".pytest_cache",
				".swc",
			])
				mkdirSync(join(source, excluded));
			writeFileSync(join(source, "node_modules", "dependency.js"), "export default true;\n");
			prepareAgentWorkspace(source, target);
			expect(readFileSync(join(target, "linked-readme.md"), "utf8")).toBe("public source\n");
			expect(lstatSync(join(target, "linked-readme.md")).isSymbolicLink()).toBe(false);
			expect(readFileSync(join(target, "dangling-fixture"), "utf8")).toBe("missing-fixture");
			expect(lstatSync(join(target, "dangling-fixture")).isSymbolicLink()).toBe(false);
			expect(lstatSync(join(target, "node_modules")).isSymbolicLink()).toBe(true);
			expect(readFileSync(join(target, "node_modules", "dependency.js"), "utf8")).toBe(
				"export default true;\n",
			);
			for (const excluded of [
				".git",
				".venv",
				"target",
				"__pycache__",
				".pytest_cache",
				".swc",
				"coverage",
			])
				expect(existsSync(join(target, excluded))).toBe(false);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("rejects preparation differences outside the intervention allowlist", () => {
		const root = mkdtempSync(join(tmpdir(), "skeleton-paired-workspace-test-"));
		try {
			const paths = { control: join(root, "control"), treatment: join(root, "treatment") };
			for (const path of Object.values(paths)) {
				mkdirSync(path);
				writeFileSync(join(path, "source.ts"), "export const limit = 20;\n");
			}
			writeFileSync(join(paths.treatment, "AGENTS.md"), "Skeleton guide\n");
			assertPairedAgentWorkspaces(paths, task("core"));
			writeFileSync(join(paths.treatment, "source.ts"), "export const limit = 30;\n");
			expect(() => assertPairedAgentWorkspaces(paths, task("core"))).toThrow(
				"difference outside allowlist: source.ts",
			);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("resumes dependency externalization after an interrupted preparation", () => {
		const root = mkdtempSync(join(tmpdir(), "skeleton-dependency-resume-test-"));
		try {
			const selected = task("core");
			const workspace = join(root, "workspaces", selected.id, "control");
			const source = join(workspace, "node_modules");
			const cache = join(root, ".qualification-cache", "dependencies", selected.id, "control");
			mkdirSync(source, { recursive: true });
			writeFileSync(join(source, "version"), "first");
			externalizeNodeModules(root, selected, workspace);
			expect(lstatSync(source).isSymbolicLink()).toBe(true);
			externalizeNodeModules(root, selected, workspace);
			rmSync(source);
			externalizeNodeModules(root, selected, workspace);
			expect(readFileSync(join(source, "version"), "utf8")).toBe("first");
			rmSync(source);
			mkdirSync(source);
			writeFileSync(join(source, "version"), "second");
			externalizeNodeModules(root, selected, workspace);
			expect(readFileSync(join(cache, "version"), "utf8")).toBe("second");
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("places native caches outside each SDK source with stable per-task paths", () => {
		const root = mkdtempSync(join(tmpdir(), "skeleton-runtime-env-test-"));
		try {
			const selected = task("core");
			const first = qualificationRuntimeEnv(root, selected);
			const second = qualificationRuntimeEnv(root, selected);
			const cargoTargetKey = "CARGO_TARGET_DIR";
			const uvEnvironmentKey = "UV_PROJECT_ENVIRONMENT";
			expect(first).toEqual(second);
			expect(first[cargoTargetKey].startsWith(tmpdir())).toBe(true);
			expect(first[uvEnvironmentKey].startsWith(tmpdir())).toBe(true);
			expect(
				first[cargoTargetKey].startsWith(publicAgentWorkspacePaths(root, selected).control),
			).toBe(false);
			selected.id = "another-task";
			expect(qualificationRuntimeEnv(root, selected)[cargoTargetKey]).not.toBe(
				first[cargoTargetKey],
			);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("keeps domain prose identical while adding ownership metadata only to treatment", () => {
		const selected = task("core");
		const control = qualificationPaper(selected, false);
		const treatment = qualificationPaper(selected, true);
		expect(plain(treatment)).toBe(plain(control));
		expect(control).not.toContain("source-of-truth");
		expect(treatment).toContain("source-of-truth");
		expect(treatment).toContain("src/owner.ts");
	});

	it("keeps missing-metadata recovery deliberately unowned", () => {
		const selected = task("recovery");
		selected.id = "fastapi-missing-metadata-recovery";
		expect(workspacePlan(selected).treatment).toBe("missing-metadata");
		expect(qualificationPaper(selected, true)).not.toContain("source-of-truth");
	});

	it("uses globs rather than directory paths for discovery ownership metadata", () => {
		const selected = task("core");
		selected.verifier.expectedPaths = ["src/middleware/jwt", "src/middleware/jwk", "docs"];
		expect(qualificationPaper(selected, true)).toContain(
			"review-deps: paths=src/middleware/jwt/**,src/middleware/jwk/**,docs/**",
		);
	});

	it("leaves adoption uninstalled with only the exact local artifact available", () => {
		const selected = task("adoption");
		expect(workspacePlan(selected)).toEqual({
			control: "plain",
			treatment: "adoption",
			installSkeleton: false,
			includeVendorArtifact: true,
		});
	});

	it("selects Expo's pinned package manager from the frozen snapshot lockfile", () => {
		const root = mkdtempSync(join(tmpdir(), "skeleton-expo-lock-test-"));
		try {
			writeFileSync(join(root, "yarn.lock"), "# yarn lockfile v1\n");
			expect(lockfileForRepository("expo/expo", root)).toBe("yarn.lock");
			expect(expoInstallCommand(root)).toEqual([
				"corepack",
				["yarn@1.22.22", "install", "--frozen-lockfile", "--ignore-scripts", "--non-interactive"],
			]);
			writeFileSync(join(root, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");
			expect(lockfileForRepository("expo/expo", root)).toBe("pnpm-lock.yaml");
			expect(expoInstallCommand(root)).toEqual([
				"corepack",
				["pnpm@10.33.0", "install", "--frozen-lockfile", "--ignore-scripts"],
			]);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("reuses an existing pinned snapshot without discarding its prepared workspace", () => {
		const root = mkdtempSync(join(tmpdir(), "skeleton-worktree-reuse-test-"));
		try {
			const repository = join(root, "repository");
			const workspace = join(root, "workspace");
			mkdirSync(repository);
			for (const args of [
				["init", "-q"],
				["config", "user.name", "Qualification test"],
				["config", "user.email", "qualification@example.invalid"],
			])
				execFileSync("git", args, { cwd: repository });
			writeFileSync(join(repository, "README.md"), "pinned\n");
			execFileSync("git", ["add", "."], { cwd: repository });
			execFileSync("git", ["commit", "-qm", "snapshot"], { cwd: repository });
			const commit = execFileSync("git", ["rev-parse", "HEAD"], {
				cwd: repository,
				encoding: "utf8",
			}).trim();
			ensurePinnedWorktree(repository, workspace, commit);
			writeFileSync(join(workspace, "prepared.marker"), "dependencies ready");
			ensurePinnedWorktree(repository, workspace, commit);
			expect(readFileSync(join(workspace, "prepared.marker"), "utf8")).toBe("dependencies ready");
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("removes only obsolete empty Skeleton settings from the first-party treatment", () => {
		const root = mkdtempSync(join(tmpdir(), "skeleton-config-test-"));
		try {
			const config = join(root, ".skeleton/config.yaml");
			mkdirSync(join(root, ".skeleton"));
			writeFileSync(
				config,
				"scan:\n  include: [docs/**]\n  exclude: []\n  banned: []\n  retiredSkills: []\ndaysUntilStale: 90\n",
			);
			const firstParty = task("core");
			firstParty.repository = "post-print/agent-spec";
			expect(normalizeAgentSpecConfig(firstParty, root)).toBe(true);
			expect(readFileSync(config, "utf8")).toBe(
				"scan:\n  include: [docs/**]\n  exclude: []\ndaysUntilStale: 90\n",
			);
			expect(normalizeAgentSpecConfig(firstParty, root)).toBe(false);
			expect(normalizeAgentSpecConfig(task("core"), root)).toBe(false);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("replaces an existing package-bin symlink without overwriting the packed CLI", () => {
		const root = mkdtempSync(join(tmpdir(), "skeleton-bin-test-"));
		try {
			const cli = join(root, "node_modules/@csark0812/skeleton/dist/cli.js");
			const bin = join(root, "node_modules/.bin");
			mkdirSync(join(root, "node_modules/@csark0812/skeleton/dist"), { recursive: true });
			mkdirSync(bin, { recursive: true });
			writeFileSync(cli, "packed-cli-content");
			symlinkSync("../@csark0812/skeleton/dist/cli.js", join(bin, "skeleton"));
			linkSkeletonExecutable(root);
			expect(readFileSync(cli, "utf8")).toBe("packed-cli-content");
			expect(readlinkSync(join(bin, "skeleton"))).toBe("../@csark0812/skeleton/dist/cli.js");
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});
