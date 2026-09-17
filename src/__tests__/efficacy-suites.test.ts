import { describe, expect, it } from "bun:test";
import { execFileSync } from "node:child_process";
import {
	cpSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkBillingDocument } from "../../scripts/efficacy/billing-document.ts";
import { HISTORY_TASKS } from "../../scripts/efficacy/history.ts";
import { median } from "../../scripts/efficacy/median.ts";
import { verifyCode } from "../../scripts/efficacy/verification.ts";

const ROOT = join(import.meta.dir, "../..");
const plain = (value: string) => value.replace(/<!--[\s\S]*?-->\s*/g, "").trim();

describe("clear comparisons of work with and without Skeleton", () => {
	it("computes median tokens without treating missing data as zero", () => {
		expect(median([980, 1000, 1040, 990, 1010])).toBe(1000);
		expect(median([840, 850, 870, 845, 855])).toBe(850);
		expect(median([1, 3])).toBe(2);
		for (const values of [[], [NaN], [Infinity]]) expect(() => median(values)).toThrow();
	});

	it("runs independent retry checks against behavior, not an agent success claim", () => {
		const temp = mkdtempSync(join(tmpdir(), "skeleton-retry-check-"));
		mkdirSync(join(temp, "src"));
		try {
			for (const retries of [0, 1, 2]) {
				writeFileSync(
					join(temp, "src/billing.ts"),
					`export const WEBHOOK_URL = "https://api.example.com/v2/billing/webhook"; export async function deliverBillingWebhook(send) { for(let n=0;n<=${retries};n++) if(await send()) return true; return false; }`,
				);
				expect(verifyCode("change-code-without-doc-reminder", temp)?.passed).toBe(retries === 1);
			}
		} finally {
			rmSync(temp, { recursive: true, force: true });
		}
	});

	it("checks billing documentation facts without requiring one exact sentence", () => {
		for (const retrySentence of [
			"Failed deliveries are retried once.",
			"Each failed delivery is retried once.",
			"The service makes one retry after a failed delivery.",
		]) {
			expect(
				Object.values(
					checkBillingDocument(
						`The live endpoint is https://api.example.com/v2/billing/webhook. ${retrySentence}`,
					),
				).every(Boolean),
			).toBe(true);
		}
		expect(
			checkBillingDocument(
				"The live endpoint is https://api.example.com/v1/billing/webhook. Failed deliveries are not retried.",
			),
		).toEqual({
			documentAvailable: true,
			currentEndpoint: false,
			retryPolicy: false,
			staleEndpointRemoved: false,
			staleRetryPolicyRemoved: false,
		});
	});

	it("adds only the real Skeleton context guide to treatment instructions", () => {
		for (const [baselineWorkspace, skeletonWorkspace] of [
			["efficiency/control", "efficiency/package-head"],
			["drift/control", "drift/skeleton"],
			["history/deleted-file/control", "history/deleted-file/skeleton"],
			["history/production-javascript/control", "history/production-javascript/skeleton"],
		]) {
			const controlGuide = readFileSync(
				join(ROOT, "tests/fixtures/efficacy", baselineWorkspace, "AGENTS.md"),
				"utf8",
			);
			const treatmentGuide = readFileSync(
				join(ROOT, "tests/fixtures/efficacy", skeletonWorkspace, "AGENTS.md"),
				"utf8",
			);
			expect(controlGuide).not.toContain("<!-- skeleton: context-guide -->");
			expect(treatmentGuide).toContain("<!-- skeleton: context-guide -->");
			expect(treatmentGuide).toContain('skeleton context "<topic>"');
			expect(treatmentGuide).toContain("the first repository command");
			expect(treatmentGuide).toContain("Use `--path` only for a known implementation path");
			expect(treatmentGuide).toContain("If a test is returned, edit and run only that test");
			expect(treatmentGuide).toContain("Otherwise use one combined command");
			expect(treatmentGuide).toContain("do not read those files again");
			expect(treatmentGuide).toContain(
				"Complete every `action` line and verify it against the final files",
			);
			expect(treatmentGuide).toContain("Preserve existing work");
			expect(treatmentGuide).toContain(
				"Do not run Skeleton audits, validation, or review-proof commands",
			);
			expect(treatmentGuide).toContain("--staged");
			expect(
				treatmentGuide.replace(/\n<!-- skeleton: context-guide -->[\s\S]*$/, "").trimEnd(),
			).toBe(controlGuide.trimEnd());
			for (const hostRoot of [".agents", ".claude", ".cursor"])
				expect(
					existsSync(
						join(
							ROOT,
							"tests/fixtures/efficacy",
							skeletonWorkspace,
							hostRoot,
							"skills/skeleton/SKILL.md",
						),
					),
				).toBe(false);
		}
		for (const task of HISTORY_TASKS) {
			const root = join(ROOT, "tests/fixtures/efficacy/history", task.name);
			expect(readFileSync(join(root, "control", task.source), "utf8")).toBe(
				readFileSync(join(root, "skeleton", task.source), "utf8"),
			);
			expect(plain(readFileSync(join(root, "control", task.doc), "utf8"))).toBe(
				plain(readFileSync(join(root, "skeleton", task.doc), "utf8")),
			);
		}
	});

	it("checks historical acceptance tests against broken and fixed implementations", () => {
		for (const task of HISTORY_TASKS) {
			const name =
				task.name === "deleted-file"
					? "fix-deleted-file-validation"
					: "fix-production-javascript-coverage";
			const workspace = join(ROOT, "tests/fixtures/efficacy/history", task.name, "control");
			expect(verifyCode(name, workspace)?.passed).toBe(false);
			const temp = mkdtempSync(join(tmpdir(), "skeleton-known-fix-"));
			try {
				cpSync(join(workspace, "src"), join(temp, "src"), { recursive: true });
				if (task.name === "deleted-file") {
					const sourcePath = join(temp, task.source);
					writeFileSync(
						sourcePath,
						readFileSync(sourcePath, "utf8").replace(
							"...uncoveredChangedPathDiagnostics(relPaths, config, ownerPatterns)",
							"...uncoveredChangedPathDiagnostics(\n\t\t\trelPaths.filter((path) => !resolvedPaths.deleted.has(path)),\n\t\t\tconfig,\n\t\t\townerPatterns,\n\t\t)",
						),
					);
					expect(verifyCode(name, temp)?.passed).toBe(false);
					rmSync(join(temp, "src"), { recursive: true, force: true });
					cpSync(join(workspace, "src"), join(temp, "src"), { recursive: true });
					writeFileSync(
						sourcePath,
						readFileSync(sourcePath, "utf8")
							.replace(
								"const coverageCandidateCount = relPaths.filter",
								"const coveragePaths = relPaths.filter((path) => !resolvedPaths.deleted.has(path) || readRepoText(root, path, fileSource) !== null);\n\tconst coverageCandidateCount = coveragePaths.filter",
							)
							.replace(
								"...uncoveredChangedPathDiagnostics(relPaths, config, ownerPatterns)",
								"...uncoveredChangedPathDiagnostics(coveragePaths, config, ownerPatterns)",
							),
					);
					expect(verifyCode(name, temp)?.passed).toBe(true);
					rmSync(join(temp, "src"), { recursive: true, force: true });
					cpSync(join(workspace, "src"), join(temp, "src"), { recursive: true });
				}
				execFileSync(
					"git",
					["apply", join(ROOT, "agent-suites/history", `${task.name}-reference.patch`)],
					{ cwd: temp },
				);
				expect(verifyCode(name, temp)?.passed).toBe(true);
			} finally {
				rmSync(temp, { recursive: true, force: true });
			}
		}
	}, 60_000);
});
