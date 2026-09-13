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

export interface ReportOptions {
	strict?: boolean;
	json?: boolean;
	label?: string;
	fileCount?: number;
	successSuffix?: string;
}

export interface IssueOptions {
	link?: string;
	severity?: Severity;
	code?: string;
	remediation?: string;
}

export interface IssueDetails extends IssueOptions {
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

const REREAD_CODES = new Set([
	"review-dependency-changed",
	"impacted-document-review-required",
	"review-document-changed",
	"review-dependency-set-changed",
]);

export function isRereadIssue(item: Issue): boolean {
	return Boolean(item.code && REREAD_CODES.has(item.code));
}

function rereadTrigger(item: Issue): string | null {
	if (item.code === "review-document-changed") return item.file;
	if (
		item.code === "review-dependency-changed" ||
		item.code === "impacted-document-review-required"
	) {
		return item.link ?? null;
	}
	return null;
}

function orderTriggers(file: string, triggers: Set<string>): string[] {
	const rest = [...triggers].filter((path) => path !== file).sort();
	return triggers.has(file) ? [file, ...rest] : rest;
}

function collectRereadTriggers(errors: Issue[]): {
	triggers: Map<string, Set<string>>;
	rest: Issue[];
} {
	const triggers = new Map<string, Set<string>>();
	const rest: Issue[] = [];
	for (const item of errors) {
		if (!isRereadIssue(item)) {
			rest.push(item);
			continue;
		}
		const current = triggers.get(item.file) ?? new Set<string>();
		const trigger = rereadTrigger(item);
		if (trigger) current.add(trigger);
		triggers.set(item.file, current);
	}
	return { triggers, rest };
}

function printRereadDiagnostic(file: string, triggers: Set<string>): void {
	console.log(`${file}: error: review required`);
	const changed = orderTriggers(file, triggers);
	if (changed.length > 0) {
		console.log(`  changed: ${changed.join(", ")}`);
		return;
	}
	console.log("  changed: review dependency set");
}

function printRereadLists(errors: Issue[]): Issue[] {
	const { triggers, rest } = collectRereadTriggers(errors);
	for (const file of [...triggers.keys()].sort()) {
		printRereadDiagnostic(file, triggers.get(file) ?? new Set());
	}
	return rest;
}

function printErrors(label: string, errors: Issue[]): number {
	console.log(`${label} failed:\n`);
	const rest = printRereadLists(errors);
	for (const item of rest) {
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
