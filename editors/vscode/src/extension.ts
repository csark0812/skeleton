import { relative } from "node:path";
import * as vscode from "vscode";
import { clearDiagnostics, publishReport } from "./diagnostics";
import {
	isConfigOrRegistry,
	isMarkdownPath,
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

	/** Per-workspace generation so overlapping runs never publish stale results. */
	const generations = new Map<string, number>();
	/** Serialize CLI audits per workspace to avoid concurrent publish races. */
	const queues = new Map<string, Promise<void>>();

	function bumpGeneration(root: string): number {
		const next = (generations.get(root) ?? 0) + 1;
		generations.set(root, next);
		return next;
	}

	function isCurrent(root: string, generation: number): boolean {
		return generations.get(root) === generation;
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
		if (!folder) return;

		const root = folder.uri.fsPath;
		const generation = bumpGeneration(root);
		const path = relativePath(folder, uri);
		const scope = isMarkdownPath(uri.path) ? uri : undefined;

		await enqueue(root, async () => {
			if (!isCurrent(root, generation)) return;

			try {
				let report: SkeletonReport;

				if (isPluginPolicy(path)) {
					report = await runDocsAndSkills(root);
					if (!isCurrent(root, generation)) return;
					publishReport(diagnostics, root, report);
					return;
				}

				if (isConfigOrRegistry(path)) {
					report = await runSkeleton(root, ["audit", "self", "--json"], output);
					if (!isCurrent(root, generation)) return;
					publishReport(diagnostics, root, report);
					return;
				}

				if (!isMarkdownPath(uri.path)) return;

				const suite = isSkillTreePath(path, root) ? "skills" : "docs";
				report = await runSkeleton(
					root,
					["audit", suite, `--paths=${path}`, "--json"],
					output,
				);
				if (!isCurrent(root, generation)) return;
				publishReport(diagnostics, root, report, uri);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				output.appendLine(`Error: ${message}`);
				if (!isCurrent(root, generation)) return;
				clearDiagnostics(diagnostics, root, scope);
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
		const generation = bumpGeneration(root);

		await enqueue(root, async () => {
			if (!isCurrent(root, generation)) return;
			try {
				const report = await runSelfAndSkills(root);
				if (!isCurrent(root, generation)) return;
				publishReport(diagnostics, root, report);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				output.appendLine(`Error: ${message}`);
				if (!isCurrent(root, generation)) return;
				clearDiagnostics(diagnostics, root);
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
			if (uri) return auditUri(uri, true);
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
