import { execFileSync } from "node:child_process";
import {
	cpSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
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
	"postprint-applications/package-head",
	"doc-reference/skeleton",
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

/** Runtime dependencies the build leaves out of dist/cli.js, which npm installs beside it. */
function unbundledDependencies(): string[] {
	const build = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).scripts.build;
	return [...build.matchAll(/--external (\S+)/g)].map((match) => match[1]);
}

function packageName(specifier: string): string {
	const parts = specifier.split("/");
	return specifier.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
}

/** Installed packages that historical Skeleton source imports; it runs unbundled, so it needs them all. */
function sourcePackageImports(srcDir: string): string[] {
	const sources = readdirSync(srcDir, { recursive: true, withFileTypes: true })
		.filter((entry) => entry.isFile() && entry.name.endsWith(".ts"))
		.map((entry) => readFileSync(join(entry.parentPath, entry.name), "utf8"));
	const names = sources.flatMap((text) =>
		[...text.matchAll(/from "([^"./][^"]*)"/g)].map(([, specifier]) => packageName(specifier)),
	);
	return [...new Set(names)]
		.filter((name) => existsSync(join(ROOT, "node_modules", name, "package.json")))
		.sort();
}

function installArtifact(tarball: string, root: string): void {
	const target = join(root, "node_modules/@csark0812/skeleton");
	rmSync(target, { recursive: true, force: true });
	mkdirSync(target, { recursive: true });
	run("tar", ["-xzf", tarball, "--strip-components=1", "-C", target]);
	const copied = new Set<string>();
	for (const name of unbundledDependencies()) copyDependency(name, root, copied);
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
	for (const task of HISTORY_TASKS) {
		for (const side of ["control", "skeleton"]) {
			const root = join(FIXTURES, "history", task.name, side);
			const copied = new Set<string>();
			for (const name of sourcePackageImports(join(root, "src")))
				copyDependency(name, root, copied);
		}
	}
	console.log(`Prepared Skeleton sides from ${packed[0].filename} (${packed[0].shasum}).`);
} finally {
	rmSync(temp, { recursive: true, force: true });
}
