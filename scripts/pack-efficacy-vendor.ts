import { execFileSync } from "node:child_process";
import {
	cpSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { HISTORY_TASKS } from "./efficacy/history.ts";

const ROOT = join(import.meta.dir, "..");
const FIXTURES = join(ROOT, "tests/fixtures/efficacy");
const TREATMENTS = [
	"drift/skeleton",
	"efficiency/package-head",
	"conflict/unmarked",
	"conflict/single-marker",
	"conflict/duplicate-markers",
	"tradeoffs/truncated/skeleton",
	"tradeoffs/missing/skeleton",
	"tradeoffs/trivial/skeleton",
	...HISTORY_TASKS.map((task) => `history/${task.name}/skeleton`),
];

function run(command: string, args: string[], cwd = ROOT): string {
	return execFileSync(command, args, {
		cwd,
		encoding: "utf8",
		env: { ...process.env, NPM_CONFIG_CACHE: join(tmpdir(), "skeleton-efficacy-npm-cache") },
	});
}

/** Copy installed runtime dependencies, never symlinks into the developer checkout. */
function copyDependency(name: string, root: string, copied: Set<string>): void {
	if (copied.has(name)) return;
	copied.add(name);
	const source = join(ROOT, "node_modules", name);
	const manifest = JSON.parse(readFileSync(join(source, "package.json"), "utf8"));
	cpSync(source, join(root, "node_modules", name), { recursive: true, dereference: true });
	for (const dependency of Object.keys(manifest.dependencies ?? {}))
		copyDependency(dependency, root, copied);
}

function installArtifact(tarball: string, root: string): void {
	const target = join(root, "node_modules/@csark0812/skeleton");
	rmSync(target, { recursive: true, force: true });
	mkdirSync(target, { recursive: true });
	run("tar", ["-xzf", tarball, "--strip-components=1", "-C", target]);
	mkdirSync(join(root, "node_modules/.bin"), { recursive: true });
	// A real launcher avoids symlinks escaping or changing snapshot permissions.
	writeFileSync(
		join(root, "node_modules/.bin/skeleton"),
		'#!/bin/sh\nexec node "$(dirname "$0")/../@csark0812/skeleton/dist/cli.js" "$@"\n',
		{ mode: 0o755 },
	);
	run("node", [join(target, "dist/cli.js"), "init", "--no-skills"], root);
	run("node", [join(target, "dist/cli.js"), "catalog"], root);
}

if (!existsSync(join(ROOT, "dist/cli.js")))
	throw new Error("Build Skeleton before preparing the package.");
const temp = mkdtempSync(join(tmpdir(), "skeleton-efficacy-pack-"));
try {
	const packed = JSON.parse(
		run("npm", ["pack", "--ignore-scripts", "--json", "--pack-destination", temp]),
	);
	const tarball = join(temp, packed[0].filename);
	mkdirSync(join(FIXTURES, "tradeoffs/adoption/skeleton/vendor"), { recursive: true });
	cpSync(tarball, join(FIXTURES, "tradeoffs/adoption/skeleton/vendor/skeleton.tgz"));
	writeFileSync(
		join(FIXTURES, "package-artifact.json"),
		JSON.stringify(
			{
				name: packed[0].name,
				version: packed[0].version,
				shasum: packed[0].shasum,
				integrity: packed[0].integrity,
			},
			null,
			2,
		) + "\n",
	);
	for (const relative of TREATMENTS) installArtifact(tarball, join(FIXTURES, relative));
	const dependencies = Object.keys(
		JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).dependencies,
	);
	for (const task of HISTORY_TASKS) {
		for (const side of ["control", "skeleton"]) {
			const copied = new Set<string>();
			for (const name of dependencies)
				copyDependency(name, join(FIXTURES, "history", task.name, side), copied);
		}
	}
	console.log(`Prepared Skeleton sides from ${packed[0].filename} (${packed[0].shasum}).`);
} finally {
	rmSync(temp, { recursive: true, force: true });
}
