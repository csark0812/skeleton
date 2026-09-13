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
	it("prints a diagnostic per failed document with its changed files", () => {
		const text = printedReport([
			issue("review-proof", "docs/b.md", {
				code: "review-dependency-changed",
				message: "review dependency changed after the recorded review: src/cli.ts",
				link: "src/cli.ts",
			}),
			issue("review-proof", "docs/a.md", {
				code: "review-dependency-changed",
				message: "review dependency changed after the recorded review: src/cli.ts",
				link: "src/cli.ts",
			}),
		]);
		expect(text).toContain("Doc audit failed:");
		expect(text).toContain("docs/a.md: error: review required\n  changed: src/cli.ts");
		expect(text).toContain("docs/b.md: error: review required\n  changed: src/cli.ts");
		expect(text).not.toContain("review dependency changed after the recorded review");
	});

	it("keeps triggers on the same failed document", () => {
		const text = printedReport([
			issue("review-proof", "AGENTS.md", {
				code: "review-document-changed",
				message: "document bytes changed after the recorded review",
			}),
			issue("review-proof", "AGENTS.md", {
				code: "review-dependency-changed",
				message: "review dependency changed after the recorded review: src/cli.ts",
				link: "src/cli.ts",
			}),
			issue("review-proof", "README.md", {
				code: "review-dependency-changed",
				message: "review dependency changed after the recorded review: src/cli.ts",
				link: "src/cli.ts",
			}),
			issue("links", "docs/other.md", "missing link target"),
		]);
		expect(text).toContain("AGENTS.md: error: review required\n  changed: AGENTS.md, src/cli.ts");
		expect(text).toContain("README.md: error: review required\n  changed: src/cli.ts");
		expect(text).toContain("docs/other.md: error: missing link target");
	});
});
