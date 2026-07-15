import { relative } from "node:path";
import * as vscode from "vscode";
import { publishReport } from "./diagnostics";
import { runSkeleton } from "./skeletonCli";

const MARKDOWN_EXTENSIONS = [".md", ".mdc"];

function workspaceFor(uri: vscode.Uri): vscode.WorkspaceFolder | undefined {
	return vscode.workspace.getWorkspaceFolder(uri);
}

function relativePath(folder: vscode.WorkspaceFolder, uri: vscode.Uri): string {
	return relative(folder.uri.fsPath, uri.fsPath).replaceAll("\\", "/");
}

function isMarkdown(uri: vscode.Uri): boolean {
	const lower = uri.path.toLowerCase();
	return MARKDOWN_EXTENSIONS.some((extension) => lower.endsWith(extension));
}

function needsWorkspaceAudit(folder: vscode.WorkspaceFolder, uri: vscode.Uri): boolean {
	const path = relativePath(folder, uri);
	return (
		path === ".skeleton/config.yaml" ||
		path === ".skeleton/registry.md" ||
		(path.startsWith(".skeleton/plugins/") && /\.ya?ml$/i.test(path))
	);
}

export function activate(context: vscode.ExtensionContext): void {
	const diagnostics = vscode.languages.createDiagnosticCollection("skeleton");
	const output = vscode.window.createOutputChannel("Skeleton");
	context.subscriptions.push(diagnostics, output);

	async function auditUri(uri: vscode.Uri, interactive = false): Promise<void> {
		const folder = workspaceFor(uri);
		if (!folder) return;

		try {
			if (needsWorkspaceAudit(folder, uri)) {
				const report = await runSkeleton(folder.uri.fsPath, ["audit", "self", "--json"], output);
				publishReport(diagnostics, folder.uri.fsPath, report);
				return;
			}
			if (!isMarkdown(uri)) return;

			const path = relativePath(folder, uri);
			const report = await runSkeleton(
				folder.uri.fsPath,
				["audit", "docs", `--paths=${path}`, "--json"],
				output,
			);
			publishReport(diagnostics, folder.uri.fsPath, report, uri);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			output.appendLine(`Error: ${message}`);
			if (interactive) void vscode.window.showErrorMessage(`Skeleton: ${message}`);
		}
	}

	async function auditWorkspace(interactive = false): Promise<void> {
		const folder =
			vscode.window.activeTextEditor &&
			workspaceFor(vscode.window.activeTextEditor.document.uri);
		if (!folder) {
			if (interactive) void vscode.window.showErrorMessage("Skeleton: no workspace folder");
			return;
		}
		try {
			const report = await runSkeleton(folder.uri.fsPath, ["audit", "self", "--json"], output);
			publishReport(diagnostics, folder.uri.fsPath, report);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			output.appendLine(`Error: ${message}`);
			if (interactive) void vscode.window.showErrorMessage(`Skeleton: ${message}`);
		}
	}

	async function fix(uri: vscode.Uri, kind: "doc-meta" | "anchors"): Promise<void> {
		const folder = workspaceFor(uri);
		if (!folder) return;
		const document = await vscode.workspace.openTextDocument(uri);
		if (document.isDirty) await document.save();

		try {
			await runSkeleton(
				folder.uri.fsPath,
				[
					"audit",
					"docs",
					`--fix=${kind}`,
					`--paths=${relativePath(folder, uri)}`,
					"--json",
				],
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
