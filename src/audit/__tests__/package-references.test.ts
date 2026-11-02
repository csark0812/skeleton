import { afterEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { scriptReferences, toolchainFacts } from "../core/package-references.ts";
import { evaluateAudit } from "../run.ts";

const scripts = (markdown: string, pm: Parameters<typeof scriptReferences>[1]) =>
	scriptReferences(markdown, pm).map((ref) => ref.script);

describe("scriptReferences", () => {
	it("finds run and bare forms in inline code and shell fences", () => {
		const markdown = [
			"Run `pnpm lint` then `pnpm run test:unit`.",
			"",
			"```bash",
			"$ pnpm install && pnpm build",
			"CI=1 pnpm check | tee out.txt",
			"```",
			"",
			"```ts",
			"pnpm ignored",
			"```",
			"",
			"pnpm not-code",
		].join("\n");
		expect(scripts(markdown, "pnpm")).toEqual(["lint", "test:unit", "build", "check"]);
		expect(scriptReferences(markdown, "pnpm")[2]).toEqual({
			script: "build",
			command: "pnpm build",
			line: 4,
		});
	});

	it("skips manager commands, files, placeholders and other workspaces", () => {
		const markdown = [
			"`pnpm install` `pnpm dlx x` `pnpm exec tsc` `pnpm --filter app build` `pnpm -r test`",
			"`bun test` `bun src/cli.ts route` `bun x.ts` `pnpm run <script>` `pnpm $SCRIPT`",
			"`npx skeleton audit docs` `npm install` `npm ci` `yarn add left-pad` `yarn workspace a b`",
		].join("\n");
		expect(scripts(markdown, "pnpm")).toEqual([]);
		expect(scripts(markdown, "bun")).toEqual([]);
		expect(scripts(markdown, "npm")).toEqual([]);
		expect(scripts(markdown, "yarn")).toEqual([]);
	});

	it("knows which bare words each manager runs as a script", () => {
		const markdown =
			"`npm test` `npm start` `npm run build` `yarn dev` `bun run check` `pnpm test`";
		expect(scripts(markdown, "npm")).toEqual(["test", "build"]);
		expect(scripts(markdown, "yarn")).toEqual(["dev"]);
		expect(scripts(markdown, "bun")).toEqual(["check"]);
		expect(scripts(markdown, "pnpm")).toEqual(["test"]);
	});
});

describe("toolchainFacts", () => {
	it("lists only the facts package.json defines", () => {
		expect(toolchainFacts({ packageManager: "pnpm@10.12.4", engines: { node: ">=22" } })).toEqual([
			{ field: "packageManager", value: "pnpm@10.12.4" },
			{ field: "engines.node", value: ">=22" },
		]);
		expect(toolchainFacts({})).toEqual([]);
	});
});

const sorted = (rows: string[][]) =>
	[...rows].sort((a, b) => a.join(" ").localeCompare(b.join(" ")));

describe("package-references rule", () => {
	let root = "";
	afterEach(() => rmSync(root, { recursive: true, force: true }));

	function write(path: string, content: string): void {
		mkdirSync(dirname(join(root, path)), { recursive: true });
		writeFileSync(join(root, path), content);
	}

	async function diagnostics(paths: string[]) {
		const result = await evaluateAudit({
			suite: "docs",
			strict: false,
			json: false,
			paths,
			only: new Set(["package-references"]),
			root,
		});
		return sorted(
			result.diagnostics.map((item) => [item.file ?? "", item.code ?? "", item.message]),
		);
	}

	function setup(): void {
		root = mkdtempSync(join(tmpdir(), "skeleton-package-refs-"));
		write("skeleton.toml", 'daysUntilStale = 365\n[scan]\ninclude = ["**/*.md"]\nexclude = []\n');
		write(
			"package.json",
			JSON.stringify({
				packageManager: "pnpm@10.12.4",
				engines: { node: ">=22.13.0" },
				scripts: { lint: "biome check" },
			}),
		);
	}

	it("reports unknown scripts in any document and missing facts only in AGENTS.md", async () => {
		setup();
		write("AGENTS.md", "Use `pnpm lint` and `pnpm verify`.\n");
		write("docs/guide.md", "Run `pnpm build`.\n");
		expect(await diagnostics(["AGENTS.md", "docs/guide.md"])).toEqual(
			sorted([
				["AGENTS.md", "unknown-script", "`pnpm verify` names no script in package.json"],
				[
					"AGENTS.md",
					"missing-toolchain-fact",
					"does not quote `pnpm@10.12.4` from package.json packageManager",
				],
				[
					"AGENTS.md",
					"missing-toolchain-fact",
					"does not quote `>=22.13.0` from package.json engines.node",
				],
				["docs/guide.md", "unknown-script", "`pnpm build` names no script in package.json"],
			]),
		);
	});

	it("passes when AGENTS.md quotes the exact facts and every script exists", async () => {
		setup();
		write("AGENTS.md", "Node.js `>=22.13.0`, `pnpm@10.12.4`. Run `pnpm lint`.\n");
		expect(await diagnostics(["AGENTS.md"])).toEqual([]);
	});

	it("checks a nested package against its own package.json", async () => {
		setup();
		write(
			"apps/web/package.json",
			JSON.stringify({ packageManager: "pnpm@10.12.4", scripts: { dev: "x" } }),
		);
		write("apps/web/README.md", "`pnpm dev` `pnpm lint`\n");
		expect(await diagnostics(["apps/web/README.md"])).toEqual([
			[
				"apps/web/README.md",
				"unknown-script",
				"`pnpm lint` names no script in apps/web/package.json",
			],
		]);
	});

	it("skips documents without a package.json or a known package manager", async () => {
		setup();
		write("package.json", JSON.stringify({ scripts: {} }));
		write("docs/guide.md", "`pnpm build`\n");
		expect(await diagnostics(["docs/guide.md"])).toEqual([]);
	});
});
