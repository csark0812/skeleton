import { afterEach, describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { evaluateRoute, formatRouteCard } from "../../validate/route.ts";

const CLI = join(import.meta.dir, "../../cli.ts");
let temps: string[] = [];

function makeRoot(): string {
	const root = mkdtempSync(join(tmpdir(), "skel-route-"));
	temps.push(root);
	mkdirSync(join(root, "docs"), { recursive: true });
	writeFileSync(
		join(root, "skeleton.toml"),
		'daysUntilStale = 365\n[scan]\ninclude = ["docs/**"]\nexclude = []\n',
	);
	writeFileSync(
		join(root, "docs/a.md"),
		`# A

<!-- source-of-truth: Alpha topic -->

<!-- doc-meta: owner=eng | last-reviewed=2099-01-01 -->

Alpha body with topic words.
`,
	);
	return root;
}

function runCli(cwd: string, args: string[]) {
	return spawnSync("bun", [CLI, ...args], {
		cwd,
		encoding: "utf8",
		env: { ...process.env, CI: "true" },
	});
}

afterEach(() => {
	for (const dir of temps) rmSync(dir, { recursive: true, force: true });
	temps = [];
});

describe("route CLI", () => {
	it("lists route on help", () => {
		const help = runCli(makeRoot(), ["--help"]);
		expect(help.status).toBe(0);
		expect(`${help.stdout}${help.stderr}`).toContain("route [path");
	});

	it("prints the lane card when route has no paths", () => {
		const card = runCli(makeRoot(), ["route"]);
		expect(card.status).toBe(0);
		expect(card.stdout).toBe(`${formatRouteCard()}\n`);
	});

	it("classifies a docs path without running an audit", async () => {
		const root = makeRoot();
		const routed = await evaluateRoute({ root, paths: ["docs/a.md"] });
		const cli = runCli(root, ["route", "docs/a.md"]);
		expect(routed.ok).toBe(true);
		expect(cli.status).toBe(0);
		expect(cli.stdout).toContain("docs\tdocs/a.md\tskeleton validate changed");
		expect(routed.lines.every((line) => line.lane !== "audit")).toBe(true);
	});

	it("marks a missing path", async () => {
		const routed = await evaluateRoute({ root: makeRoot(), paths: ["docs/missing.md"] });
		expect(routed.ok).toBe(true);
		expect(routed.lines).toContainEqual({
			lane: "missing",
			path: "docs/missing.md",
			action: "missing",
		});
	});
});
