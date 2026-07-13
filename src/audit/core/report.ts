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
	message: string,
	opts?: { link?: string; severity?: Severity },
): Issue {
	return {
		rule,
		file,
		link: opts?.link,
		message,
		severity: opts?.severity ?? "error",
	};
}

export function finalizeIssues(issues: Issue[], strict: boolean): Issue[] {
	if (!strict) return issues;
	return issues.map((i) => (i.severity === "warning" ? { ...i, severity: "error" as const } : i));
}

export function printReport(issues: Issue[], options: ReportOptions): number {
	const finalized = finalizeIssues(issues, options.strict ?? false);
	const errors = finalized.filter((i) => i.severity === "error");
	const warnings = finalized.filter((i) => i.severity === "warning");
	const label = options.label ?? "Audit";

	if (options.json) {
		console.log(
			JSON.stringify(
				{
					label,
					fileCount: options.fileCount,
					errors: errors.length,
					warnings: warnings.length,
					issues: finalized,
				},
				null,
				2,
			),
		);
		return errors.length > 0 ? 1 : 0;
	}

	if (warnings.length > 0) {
		console.log(`${label} warnings:\n`);
		for (const i of warnings) {
			const linkPart = i.link ? ` (${i.link})` : "";
			console.log(`- ${i.file}${linkPart}: ${i.message}`);
		}
		console.log("");
	}

	if (errors.length === 0) {
		const warnNote = warnings.length > 0 ? `, ${warnings.length} warning(s)` : "";
		const countNote =
			options.successSuffix ??
			(options.fileCount !== undefined ? ` (${options.fileCount} files scanned${warnNote})` : "");
		console.log(`${label} passed${countNote}.`);
		return 0;
	}

	console.log(`${label} failed:\n`);
	for (const i of errors) {
		const linkPart = i.link ? ` (${i.link})` : "";
		console.log(`- ${i.file}${linkPart}: ${i.message}`);
	}
	return 1;
}
