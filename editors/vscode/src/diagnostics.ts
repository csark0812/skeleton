import { isAbsolute, join, relative } from "node:path";
import * as vscode from "vscode";
import { mergePathScopedDiagnostics } from "./global-rules";
import type { SkeletonIssue, SkeletonReport } from "./types";

function issueUri(root: string, file: string): vscode.Uri {
	return vscode.Uri.file(isAbsolute(file) ? file : join(root, file));
}

function issueRange(issue: SkeletonIssue): vscode.Range {
	if (!issue.range) return new vscode.Range(0, 0, 0, 0);

	const start = new vscode.Position(
		Math.max(issue.range.start.line - 1, 0),
		Math.max(issue.range.start.column - 1, 0),
	);
	const end = new vscode.Position(
		Math.max(issue.range.end.line - 1, start.line),
		Math.max(issue.range.end.column - 1, 0),
	);
	return new vscode.Range(start, end);
}

function toDiagnostic(issue: SkeletonIssue): vscode.Diagnostic {
	const severity =
		issue.severity === "error"
			? vscode.DiagnosticSeverity.Error
			: vscode.DiagnosticSeverity.Warning;
	const diagnostic = new vscode.Diagnostic(issueRange(issue), issue.message, severity);
	diagnostic.source = "skeleton";
	diagnostic.code = issue.rule;
	return diagnostic;
}

function clearRoot(collection: vscode.DiagnosticCollection, root: string): void {
	collection.forEach((uri) => {
		const path = relative(root, uri.fsPath);
		if (path === "" || (!path.startsWith("..") && !isAbsolute(path))) collection.delete(uri);
	});
}

/** Clear diagnostics for one file or the whole workspace root. */
export function clearDiagnostics(
	collection: vscode.DiagnosticCollection,
	root: string,
	scope?: vscode.Uri,
): void {
	if (scope) collection.delete(scope);
	else clearRoot(collection, root);
}

export function publishReport(
	collection: vscode.DiagnosticCollection,
	root: string,
	report: SkeletonReport,
	scope?: vscode.Uri,
): void {
	const grouped = new Map<string, { uri: vscode.Uri; diagnostics: vscode.Diagnostic[] }>();
	for (const issue of report.issues) {
		const uri = issueUri(root, issue.file);
		const key = uri.toString();
		const entry = grouped.get(key) ?? { uri, diagnostics: [] };
		entry.diagnostics.push(toDiagnostic(issue));
		grouped.set(key, entry);
	}

	if (scope) {
		const incoming = grouped.get(scope.toString())?.diagnostics ?? [];
		const existing = collection.get(scope) ?? [];
		collection.set(
			scope,
			mergePathScopedDiagnostics(existing, incoming, (diagnostic) =>
				typeof diagnostic.code === "string" ? diagnostic.code : undefined,
			),
		);
		return;
	}

	clearRoot(collection, root);
	collection.set([...grouped.values()].map(({ uri, diagnostics }) => [uri, diagnostics]));
}
