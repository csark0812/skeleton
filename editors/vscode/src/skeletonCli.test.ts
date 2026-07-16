import { describe, expect, it } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveSkeletonCommand } from "./skeletonCliResolve.ts";

describe("resolveSkeletonCommand", () => {
	it("runs configured .js paths via process.execPath", () => {
		const cliJs = join(tmpdir(), "skeleton-cli.js");
		const resolved = resolveSkeletonCommand("/any", cliJs);
		expect(resolved.executable).toBe(process.execPath);
		expect(resolved.prefixArgs).toEqual([cliJs]);
	});

	it("spawns configured non-JS binaries directly", () => {
		const bin = "/usr/local/bin/skeleton";
		const resolved = resolveSkeletonCommand("/any", bin);
		expect(resolved.executable).toBe(bin);
		expect(resolved.prefixArgs).toEqual([]);
	});

	it("rejects relative skeleton.path", () => {
		expect(() => resolveSkeletonCommand("/any", "dist/cli.js")).toThrow(/absolute/);
	});

	it("resolves local @csark0812/skeleton/dist/cli.js via node_modules walk", () => {
		const root = join(tmpdir(), `skeleton-cli-resolve-${Date.now()}`);
		const packageDir = join(root, "node_modules", "@csark0812", "skeleton");
		mkdirSync(join(packageDir, "dist"), { recursive: true });
		const cliJs = join(packageDir, "dist", "cli.js");
		writeFileSync(cliJs, "#!/usr/bin/env node\n");
		try {
			const resolved = resolveSkeletonCommand(root);
			expect(resolved.executable).toBe(process.execPath);
			expect(resolved.prefixArgs).toEqual([cliJs]);
			expect(resolved.executable.endsWith(".cmd")).toBe(false);
			expect(resolved.prefixArgs.some((arg) => arg.endsWith(".cmd"))).toBe(false);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("throws a clear error when no CLI is installed", () => {
		const root = join(tmpdir(), `skeleton-cli-missing-${Date.now()}`);
		mkdirSync(root, { recursive: true });
		try {
			expect(() => resolveSkeletonCommand(root)).toThrow(/Install @csark0812\/skeleton/);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});
