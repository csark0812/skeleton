import { relative } from "node:path";
import * as vscode from "vscode";
import { publishReport } from "./diagnostics";
import {
	isAuditablePath,
	isConfigOrRegistry,
	isPluginPolicy,
	isSkillTreePath,
} from "./paths";
import { mergeReports } from "./report";
import { runSkeleton } from "./skeletonCli";
import type { SkeletonReport } from "./types";

function workspaceFor(uri: vscode.Uri): vscode.WorkspaceFolder | undefined {
	return vscode.workspace.getWorkspaceFolder(uri);
}

function relativePath(folder: vscode.WorkspaceFolder, uri: vscode.Uri): string {
	return relative(folder.uri.fsPath, uri.fsPath).replaceAll("\\", "/");
}

export function activate(context: vscode.ExtensionContext): void {
	const diagnostics = vscode.languages.createDiagnosticCollection("skeleton");
	const output = vscode.window.createOutputChannel("Skeleton");
	context.subscriptions.push(diagnostics, output);

	/**
	 * Per-path generation for path-scoped audits so auditing file B never
	 * cancels a pending audit of file A. Workspace-wide runs bump a separate
	 * counter that supersedes in-flight path-scoped work.
	 */
	const pathGenerations = new Map<string, Map<string, number>>();
	const workspaceGenerations = new Map<string, number>();
	/** Serialize CLI audits per workspace to avoid concurrent publish races. */
	const queues = new Map<string, Promise<void>>();

	function bumpPathGeneration(root: string, path: string): number {
		let paths = pathGenerations.get(root);
		if (!paths) {
			paths = new Map();
			pathGenerations.set(root, paths);
		}
		const next = (paths.get(path) ?? 0) + 1;
		paths.set(path, next);
		return next;
	}

	function currentPathGeneration(root: string, path: string): number {
		return pathGenerations.get(root)?.get(path) ?? 0;
	}

	function bumpWorkspaceGeneration(root: string): number {
		const next = (workspaceGenerations.get(root) ?? 0) + 1;
		workspaceGenerations.set(root, next);
		return next;
	}

	function currentWorkspaceGeneration(root: string): number {
		return workspaceGenerations.get(root) ?? 0;
	}

	function enqueue(root: string, work: () => Promise<void>): Promise<void> {
		const prior = queues.get(root) ?? Promise.resolve();
		const next = prior.then(work, work);
		queues.set(
			root,
			next.then(
				() => undefined,
				() => undefined,
			),
		);
		return next;
	}

	async function runDocsAndSkills(root: string): Promise<SkeletonReport> {
		const docs = await runSkeleton(root, ["audit", "docs", "--json"], output);
		const skills = await runSkeleton(root, ["audit", "skills", "--json"], output);
		return mergeReports([docs, skills], "Docs + skills audit");
	}

	async function runSelfAndSkills(root: string): Promise<SkeletonReport> {
		const self = await runSkeleton(root, ["audit", "self", "--json"], output);
		const skills = await runSkeleton(root, ["audit", "skills", "--json"], output);
		return mergeReports([self, skills], "Self + skills audit");
	}

	async function auditUri(uri: vscode.Uri, interactive = false): Promise<void> {
		const folder = workspaceFor(uri);
		if (!folder) {
			if (interactive) {
				void vscode.window.showErrorMessage("Skeleton: no workspace folder for this file");
			}
			return;
		}

		const root = folder.uri.fsPath;
		const path = relativePath(folder, uri);
		if (!isAuditablePath(path, uri.path)) {
			if (interactive) {
				void vscode.window.showErrorMessage(
					"Skeleton: current file is not auditable (Markdown, config, registry, or plugin policy)",
				);
			}
			return;
		}

		const isWorkspaceTarget = isPluginPolicy(path) || isConfigOrRegistry(path);
		const pathGeneration = isWorkspaceTarget ? 0 : bumpPathGeneration(root, path);
		const workspaceGeneration = isWorkspaceTarget
			? bumpWorkspaceGeneration(root)
			: currentWorkspaceGeneration(root);

		await enqueue(root, async () => {
			if (isWorkspaceTarget) {
				if (workspaceGeneration !== currentWorkspaceGeneration(root)) return;
			} else if (
				pathGeneration !== currentPathGeneration(root, path) ||
				workspaceGeneration !== currentWorkspaceGeneration(root)
			) {
				return;
			}

			try {
				let report: SkeletonReport;

				if (isPluginPolicy(path)) {
					report = await runDocsAndSkills(root);
					if (workspaceGeneration !== currentWorkspaceGeneration(root)) return;
					publishReport(diagnostics, root, report);
					return;
				}

				if (isConfigOrRegistry(path)) {
					// Match Audit Workspace: self alone does not cover excluded skill trees.
					report = await runSelfAndSkills(root);
					if (workspaceGeneration !== currentWorkspaceGeneration(root)) return;
					publishReport(diagnostics, root, report);
					return;
				}

				const suite = isSkillTreePath(path, root) ? "skills" : "docs";
				report = await runSkeleton(
					root,
					["audit", suite, `--paths=${path}`, "--json"],
					output,
				);
				if (
					pathGeneration !== currentPathGeneration(root, path) ||
					workspaceGeneration !== currentWorkspaceGeneration(root)
				) {
					return;
				}
				publishReport(diagnostics, root, report, uri);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				output.appendLine(`Error: ${message}`);
				// Keep prior Problems on failure — clearing would present a false clean.
				if (interactive) void vscode.window.showErrorMessage(`Skeleton: ${message}`);
			}
		});
	}

	async function auditWorkspace(interactive = false): Promise<void> {
		const folder =
			vscode.window.activeTextEditor &&
			workspaceFor(vscode.window.activeTextEditor.document.uri);
		if (!folder) {
			if (interactive) void vscode.window.showErrorMessage("Skeleton: no workspace folder");
			return;
		}

		const root = folder.uri.fsPath;
		const workspaceGeneration = bumpWorkspaceGeneration(root);

		await enqueue(root, async () => {
			if (workspaceGeneration !== currentWorkspaceGeneration(root)) return;
			try {
				const report = await runSelfAndSkills(root);
				if (workspaceGeneration !== currentWorkspaceGeneration(root)) return;
				publishReport(diagnostics, root, report);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				output.appendLine(`Error: ${message}`);
				// Keep prior Problems on failure — clearing would present a false clean.
				if (interactive) void vscode.window.showErrorMessage(`Skeleton: ${message}`);
			}
		});
	}

	async function fix(uri: vscode.Uri, kind: "doc-meta" | "anchors"): Promise<void> {
		const folder = workspaceFor(uri);
		if (!folder) return;
		const document = await vscode.workspace.openTextDocument(uri);
		if (document.isDirty) await document.save();

		const root = folder.uri.fsPath;
		const path = relativePath(folder, uri);

		try {
			await runSkeleton(
				root,
				["audit", "docs", `--fix=${kind}`, `--paths=${path}`, "--json"],
				output,
			);
			await auditUri(uri, true);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			output.appendLine(`Error: ${message}`);
			void vscode.window.showErrorMessage(`Skeleton: ${message}`);
		}
	}

	context.subscriptions.push(
		vscode.workspace.onDidOpenTextDocument((document) => {
			if (vscode.workspace.getConfiguration("skeleton").get("runOnOpen", true)) {
				void auditUri(document.uri);
			}
		}),
		vscode.workspace.onDidSaveTextDocument((document) => {
			if (vscode.workspace.getConfiguration("skeleton").get("runOnSave", true)) {
				void auditUri(document.uri);
			}
		}),
		vscode.commands.registerCommand("skeleton.auditCurrentFile", () => {
			const uri = vscode.window.activeTextEditor?.document.uri;
			if (!uri) {
				void vscode.window.showErrorMessage("Skeleton: no active editor");
				return;
			}
			return auditUri(uri, true);
		}),
		vscode.commands.registerCommand("skeleton.auditWorkspace", () => auditWorkspace(true)),
		vscode.commands.registerCommand("skeleton.clearDiagnostics", () => diagnostics.clear()),
		vscode.commands.registerCommand("skeleton.showOutput", () => output.show()),
		vscode.commands.registerCommand("skeleton.fixDocMeta", (uri?: vscode.Uri) => {
			const target = uri ?? vscode.window.activeTextEditor?.document.uri;
			if (target) return fix(target, "doc-meta");
		}),
		vscode.commands.registerCommand("skeleton.fixAnchors", (uri?: vscode.Uri) => {
			const target = uri ?? vscode.window.activeTextEditor?.document.uri;
			if (target) return fix(target, "anchors");
		}),
		vscode.languages.registerCodeActionsProvider(
			{ language: "markdown", scheme: "file" },
			{
				provideCodeActions(document, _range, codeActionContext) {
					const actions: vscode.CodeAction[] = [];
					for (const diagnostic of codeActionContext.diagnostics) {
						if (diagnostic.source !== "skeleton") continue;
						if (diagnostic.code === "doc-meta") {
							const action = new vscode.CodeAction(
								"Skeleton: Fix doc metadata",
								vscode.CodeActionKind.QuickFix,
							);
							action.command = {
								command: "skeleton.fixDocMeta",
								title: action.title,
								arguments: [document.uri],
							};
							action.diagnostics = [diagnostic];
							actions.push(action);
						}
						if (diagnostic.code === "links" && diagnostic.message.includes("broken anchor")) {
							const action = new vscode.CodeAction(
								"Skeleton: Fix anchor",
								vscode.CodeActionKind.QuickFix,
							);
							action.command = {
								command: "skeleton.fixAnchors",
								title: action.title,
								arguments: [document.uri],
							};
							action.diagnostics = [diagnostic];
							actions.push(action);
						}
					}
					return actions;
				},
			},
			{ providedCodeActionKinds: [vscode.CodeActionKind.QuickFix] },
		),
	);

	if (vscode.workspace.getConfiguration("skeleton").get("runOnOpen", true)) {
		for (const document of vscode.workspace.textDocuments) void auditUri(document.uri);
	}
}

export function deactivate(): void {}
