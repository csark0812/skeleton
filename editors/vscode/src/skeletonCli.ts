import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import * as vscode from "vscode";
import type { SkeletonReport } from "./types";

interface ResolvedCommand {
	executable: string;
	prefixArgs: string[];
}

function resolveCommand(root: string): ResolvedCommand {
	const configured = vscode.workspace.getConfiguration("skeleton").get<string>("path", "").trim();
	if (configured) {
		if (!isAbsolute(configured)) {
			throw new Error("skeleton.path must be an absolute executable path");
		}
		return { executable: configured, prefixArgs: [] };
	}

	const executableName = process.platform === "win32" ? "skeleton.cmd" : "skeleton";
	const local = join(root, "node_modules", ".bin", executableName);
	if (existsSync(local)) return { executable: local, prefixArgs: [] };

	return {
		executable: process.platform === "win32" ? "npx.cmd" : "npx",
		prefixArgs: ["--no-install", "skeleton"],
	};
}

function isReport(value: unknown): value is SkeletonReport {
	if (!value || typeof value !== "object") return false;
	const report = value as Partial<SkeletonReport>;
	return (
		typeof report.label === "string" &&
		typeof report.errors === "number" &&
		typeof report.warnings === "number" &&
		Array.isArray(report.issues) &&
		report.issues.every(
			(issue) =>
				issue !== null &&
				typeof issue === "object" &&
				typeof issue.rule === "string" &&
				typeof issue.file === "string" &&
				typeof issue.message === "string" &&
				(issue.severity === "error" || issue.severity === "warning"),
		)
	);
}

export async function runSkeleton(
	root: string,
	args: string[],
	output: vscode.OutputChannel,
): Promise<SkeletonReport> {
	const command = resolveCommand(root);
	const commandArgs = [...command.prefixArgs, ...args];
	output.appendLine(`$ ${command.executable} ${commandArgs.join(" ")}`);

	const result = await new Promise<{ stdout: string; stderr: string; code: number | null }>(
		(resolve, reject) => {
			const child = spawn(command.executable, commandArgs, {
				cwd: root,
				shell: false,
				windowsHide: true,
			});
			let stdout = "";
			let stderr = "";
			child.stdout.setEncoding("utf8");
			child.stderr.setEncoding("utf8");
			child.stdout.on("data", (chunk: string) => {
				stdout += chunk;
			});
			child.stderr.on("data", (chunk: string) => {
				stderr += chunk;
			});
			child.on("error", reject);
			child.on("close", (code) => resolve({ stdout, stderr, code }));
		},
	);

	if (result.stderr.trim()) output.appendLine(result.stderr.trim());

	let parsed: unknown;
	try {
		parsed = JSON.parse(result.stdout);
	} catch {
		const detail = result.stderr.trim() || result.stdout.trim() || `exit code ${result.code}`;
		throw new Error(`Skeleton did not return a JSON report: ${detail}`);
	}
	if (!isReport(parsed)) throw new Error("Skeleton returned an unsupported JSON report");

	output.appendLine(
		`${parsed.label}: ${parsed.errors} error(s), ${parsed.warnings} warning(s)`,
	);
	return parsed;
}
