export type Severity = "error" | "warning";

export interface Issue {
	rule: string;
	file: string;
	link?: string;
	message: string;
	severity: Severity;
}

export interface ReportOptions {
	strict?: boolean;
	json?: boolean;
	label?: string;
	fileCount?: number;
	successSuffix?: string;
}

export function issue(
	rule: string,
	file: string,
	details: string | { message: string; link?: string; severity?: Severity },
): Issue {
	const message = typeof details === "string" ? details : details.message;
	return {
		rule,
		file,
		link: typeof details === "string" ? undefined : details.link,
		message,
		severity: typeof details === "string" ? "error" : (details.severity ?? "error"),
	};
}

export function finalizeIssues(issues: Issue[], strict: boolean): Issue[] {
	if (!strict) return issues;
	return issues.map((i) => (i.severity === "warning" ? { ...i, severity: "error" as const } : i));
}

interface ReportPrintContext {
	label: string;
	options: ReportOptions;
	errors: Issue[];
	warnings: Issue[];
	finalized: Issue[];
}

export function printReport(issues: Issue[], options: ReportOptions): number {
	const finalized = finalizeIssues(issues, options.strict ?? false);
	const errors = finalized.filter((i) => i.severity === "error");
	const warnings = finalized.filter((i) => i.severity === "warning");
	const label = options.label ?? "Audit";
	const ctx: ReportPrintContext = { label, options, errors, warnings, finalized };

	if (options.json) return printJsonReport(ctx);
	return printTextReport(ctx);
}

function printJsonReport(ctx: ReportPrintContext): number {
	console.log(
		JSON.stringify(
			{
				label: ctx.label,
				fileCount: ctx.options.fileCount,
				errors: ctx.errors.length,
				warnings: ctx.warnings.length,
				issues: ctx.finalized,
			},
			null,
			2,
		),
	);
	return ctx.errors.length > 0 ? 1 : 0;
}

function printWarnings(label: string, warnings: Issue[]): void {
	if (warnings.length === 0) return;
	console.log(`${label} warnings:\n`);
	for (const i of warnings) {
		const linkPart = i.link ? ` (${i.link})` : "";
		console.log(`- ${i.file}${linkPart}: ${i.message}`);
	}
	console.log("");
}

function printSuccess(label: string, options: ReportOptions, warnings: Issue[]): number {
	const warnNote = warnings.length > 0 ? `, ${warnings.length} warning(s)` : "";
	const countNote =
		options.successSuffix ??
		(options.fileCount !== undefined ? ` (${options.fileCount} files scanned${warnNote})` : "");
	console.log(`${label} passed${countNote}.`);
	return 0;
}

function printErrors(label: string, errors: Issue[]): number {
	console.log(`${label} failed:\n`);
	for (const i of errors) {
		const linkPart = i.link ? ` (${i.link})` : "";
		console.log(`- ${i.file}${linkPart}: ${i.message}`);
	}
	return 1;
}

function printTextReport(ctx: ReportPrintContext): number {
	const { label, options, errors, warnings } = ctx;
	printWarnings(label, warnings);
	if (errors.length === 0) return printSuccess(label, options, warnings);
	return printErrors(label, errors);
}
