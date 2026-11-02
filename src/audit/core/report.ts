export type Severity = "error" | "warning";

export interface Issue {
	rule: string;
	code?: string;
	file: string;
	link?: string;
	message: string;
	remediation?: string;
	severity: Severity;
}

interface ReportOptions {
	strict?: boolean;
	json?: boolean;
	label?: string;
	fileCount?: number;
	successSuffix?: string;
}

interface IssueOptions {
	link?: string;
	severity?: Severity;
	code?: string;
	remediation?: string;
}

interface IssueDetails extends IssueOptions {
	message: string;
}

export function issue(rule: string, file: string, details: string | IssueDetails): Issue;
/** @deprecated Prefer the details-object form. Retained for 1.x plugin compatibility. */
// biome-ignore lint/complexity/useMaxParams: the four-argument shape is a frozen 1.x plugin ABI
export function issue(rule: string, file: string, message: string, options?: IssueOptions): Issue;
// biome-ignore lint/complexity/useMaxParams: implementation must accept the frozen 1.x overload
export function issue(
	rule: string,
	file: string,
	details: string | IssueDetails,
	options?: IssueOptions,
): Issue {
	const message = typeof details === "string" ? details : details.message;
	const selected = typeof details === "string" ? options : details;
	return {
		rule,
		...(selected?.code ? { code: selected.code } : {}),
		file,
		link: selected?.link,
		message,
		...(selected?.remediation ? { remediation: selected.remediation } : {}),
		severity: selected?.severity ?? "error",
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
	for (const item of warnings) {
		console.log(`${item.file}: warning: ${item.message}`);
	}
	if (warnings.some(isRereadIssue)) {
		console.log(
			"\nRe-read each listed document in full against the changed files and update it in the same change if it is out of date.",
		);
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

/** A document to re-read because a file it declares in `review-deps` changed. */
export function isRereadIssue(item: Issue): boolean {
	return item.code === "review-dependency-changed";
}

function printErrors(label: string, errors: Issue[]): number {
	console.log(`${label} failed:\n`);
	for (const item of errors) {
		console.log(`${item.file}: error: ${item.message}`);
	}
	return 1;
}

function printTextReport(ctx: ReportPrintContext): number {
	const { label, options, errors, warnings } = ctx;
	printWarnings(label, warnings);
	if (errors.length === 0) return printSuccess(label, options, warnings);
	return printErrors(label, errors);
}
