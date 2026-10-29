import { describe, expect, it, spyOn } from "bun:test";
import { issue, printReport } from "../core/report.ts";

function printedReport(
	issues: Parameters<typeof printReport>[0],
	options: Parameters<typeof printReport>[1] = { label: "Doc audit" },
): string {
	const lines: string[] = [];
	const log = spyOn(console, "log").mockImplementation((value) => lines.push(String(value)));
	try {
		printReport(issues, options);
		return lines.join("\n");
	} finally {
		log.mockRestore();
	}
}

describe("audit text report", () => {
	it("lists each changed dependency as a warning with one re-read hint", () => {
		const text = printedReport([
			issue("validate-changed", "docs/a.md", {
				code: "review-dependency-changed",
				message: "declared dependency changed but the document did not: src/cli.ts",
				link: "src/cli.ts",
				severity: "warning",
			}),
			issue("validate-changed", "docs/b.md", {
				code: "review-dependency-changed",
				message: "declared dependency changed but the document did not: src/cli.ts",
				link: "src/cli.ts",
				severity: "warning",
			}),
		]);
		expect(text).toContain(
			"docs/a.md: warning: declared dependency changed but the document did not: src/cli.ts",
		);
		expect(text).toContain(
			"docs/b.md: warning: declared dependency changed but the document did not: src/cli.ts",
		);
		expect(text.match(/Re-read each listed document/g)).toHaveLength(1);
		expect(text).toContain("Doc audit passed");
	});
});
