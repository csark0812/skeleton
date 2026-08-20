import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import process from "node:process";

const root = resolve(import.meta.dir, "..");

function run(input: {
	command: string;
	args: string[];
	cwd: string;
	env?: NodeJS.ProcessEnv;
}): string {
	const { command, args, cwd, env = process.env } = input;
	const result = spawnSync(command, args, { cwd, encoding: "utf8", env });
	if (result.status !== 0) {
		throw new Error(
			`${command} ${args.join(" ")} failed\n${result.stdout ?? ""}${result.stderr ?? ""}`,
		);
	}
	return result.stdout;
}

function requireFile(path: string): void {
	if (!existsSync(path)) throw new Error(`Packed package is missing ${path}`);
}

const temp = mkdtempSync(join(tmpdir(), "skeleton-package-verify-"));
try {
	const packDir = join(temp, "pack");
	const packageDir = join(temp, "consumer", "node_modules", "@csark0812", "skeleton");
	mkdirSync(packDir, { recursive: true });
	mkdirSync(packageDir, { recursive: true });
	const npmEnv = { ...process.env, NPM_CONFIG_CACHE: join(temp, "npm-cache") };

	const packed = JSON.parse(
		run({
			command: "npm",
			args: ["pack", "--ignore-scripts", "--json", "--pack-destination", packDir],
			cwd: root,
			env: npmEnv,
		}),
	) as Array<{ filename?: string }>;
	const filename = packed[0]?.filename;
	if (!filename) throw new Error("npm pack did not return a tarball filename");
	const tarball = join(packDir, basename(filename));
	run({
		command: "tar",
		args: ["-xzf", tarball, "--strip-components=1", "-C", packageDir],
		cwd: root,
	});

	for (const rel of [
		"dist/cli.js",
		"dist/plugin-types.d.ts",
		"dist/plugin-types.js",
		"dist/result-types.d.ts",
		"schemas/config.schema.json",
		"schemas/policy-file.schema.json",
		"schemas/result.schema.json",
	]) {
		requireFile(join(packageDir, rel));
	}

	const consumer = join(temp, "consumer");
	writeFileSync(
		join(consumer, "package.json"),
		JSON.stringify({ private: true, type: "module" }, null, 2),
	);
	writeFileSync(
		join(consumer, "tsconfig.json"),
		JSON.stringify(
			{
				compilerOptions: {
					strict: true,
					noEmit: true,
					module: "NodeNext",
					moduleResolution: "NodeNext",
					target: "ES2022",
					skipLibCheck: false,
				},
				include: ["consumer.ts"],
			},
			null,
			2,
		),
	);
	writeFileSync(
		join(consumer, "consumer.ts"),
		`import { issue } from "@csark0812/skeleton/plugin-types";
import type { AuditContext, AuditRule } from "@csark0812/skeleton/plugin-types";
import type { AuditResult, ValidateChangedResult } from "@csark0812/skeleton/result-types";

const rule: AuditRule = { id: "consumer", run: (ctx: AuditContext) => [issue("consumer", ctx.root, { message: "ok" })] };
const audit = {} as AuditResult;
const validate = {} as ValidateChangedResult;
void [rule, audit.reviewProof.status, validate.impactedDocuments];
`,
	);

	const tsc = join(root, "node_modules", ".bin", "tsc");
	run({ command: tsc, args: ["-p", "tsconfig.json"], cwd: consumer });
	run({ command: "node", args: [join(packageDir, "dist", "cli.js"), "--help"], cwd: consumer });

	const packageJson = JSON.parse(readFileSync(join(packageDir, "package.json"), "utf8")) as {
		exports?: Record<string, unknown>;
	};
	for (const key of ["./plugin-types", "./result-types", "./schemas/result.schema.json"]) {
		if (!(key in (packageJson.exports ?? {}))) throw new Error(`Packed exports missing ${key}`);
	}
	console.log(`package verification passed: ${basename(tarball)}`);
} finally {
	rmSync(temp, { recursive: true, force: true });
}
