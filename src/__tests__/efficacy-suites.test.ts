import { describe, expect, it } from "bun:test";
import { execFileSync, spawnSync } from "node:child_process";
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
import type { Workspace } from "@post-print/agent-test";
import { checkBillingDocument } from "../../scripts/efficacy/billing-document.ts";
import { HISTORY_TASKS } from "../../scripts/efficacy/history.ts";
import { median } from "../../scripts/efficacy/median.ts";
import { summarizeDetection } from "../../scripts/efficacy/review-detection.ts";
import { verifyCode } from "../../scripts/efficacy/verification.ts";
import { seedReviewChange } from "../../scripts/efficacy/workspace.ts";

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
			["postprint-applications/control", "postprint-applications/package-head"],
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
			expect(treatmentGuide).toContain("Never combine a topic with `--path`");
			expect(treatmentGuide).toContain(
				"If a test is returned, make the edits and run only the returned `test-command`",
			);
			expect(treatmentGuide).toContain("Otherwise use one combined command");
			expect(treatmentGuide).toContain("do not read those files again");
			expect(treatmentGuide).toContain(
				"answer immediately when the returned evidence fully answers a read-only request",
			);
			expect(treatmentGuide).toContain(
				"Do not run repository-wide searches, file listings, or status checks to reconfirm a complete result",
			);
			expect(treatmentGuide).toContain(
				"Do not rerun context or search, list, or read returned paths",
			);
			expect(treatmentGuide).toContain("Inspect again only when that test fails");
			expect(treatmentGuide).toContain("without progress narration between the edits and test");
			expect(treatmentGuide).toContain(
				"Complete every `action` line and verify it against the final files",
			);
			expect(treatmentGuide).toContain("Preserve existing work");
			expect(treatmentGuide).toContain("Do not run Skeleton audits or validation");
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

	it("counts review detection per check and keeps tokens from incorrect runs", () => {
		const checks = (found: boolean) => ({
			generic: true,
			guideRule: found,
			staleDoc: found,
			deletionGuide: false,
			intentMismatch: false,
			decoyNotImportant: true,
		});
		const summary = summarizeDetection([
			{
				baseline: { status: "incorrect", reason: "", checks: checks(false), tokens: 100 },
				withSkeleton: { status: "incorrect", reason: "", checks: checks(true), tokens: 80 },
			},
			{
				baseline: { status: "execution-error", reason: "provider failure" },
				withSkeleton: { status: "incorrect", reason: "", checks: checks(false), tokens: 60 },
			},
		]);
		expect(summary.baseline).toMatchObject({
			attempted: 2,
			evaluated: 1,
			hits: { generic: 1, guideRule: 0 },
			medianTokens: 100,
		});
		expect(summary.withSkeleton).toMatchObject({
			attempted: 2,
			evaluated: 2,
			hits: { generic: 2, guideRule: 1, decoyNotImportant: 2 },
			medianTokens: 70,
		});
	});

	it("gives both review sides the same change and bundles the seeded evidence", () => {
		const root = join(ROOT, "tests/fixtures/efficacy/review-change");
		for (const path of [
			"src/billing/charge.ts",
			"src/billing/refund.ts",
			"src/orders/total.ts",
			"src/orders/format.ts",
			"src/payouts/hold.ts",
			"src/api/payout-route.ts",
		])
			expect(readFileSync(join(root, "control", path), "utf8")).toBe(
				readFileSync(join(root, "skeleton", path), "utf8"),
			);
		for (const path of ["docs/billing.md", "docs/billing/REVIEW.md", "docs/payouts/REVIEW.md"])
			expect(plain(readFileSync(join(root, "control", path), "utf8"))).toBe(
				plain(readFileSync(join(root, "skeleton", path), "utf8")),
			);
		expect(existsSync(join(root, "control/skeleton.toml"))).toBe(false);

		const temp = mkdtempSync(join(tmpdir(), "skeleton-review-change-"));
		const git = (...args: string[]) => execFileSync("git", args, { cwd: temp, encoding: "utf8" });
		try {
			cpSync(join(root, "skeleton"), temp, { recursive: true });
			git("init", "--quiet", "-b", "main");
			git("config", "user.email", "fixture@example.com");
			git("config", "user.name", "Fixture");
			git("add", "-A");
			git("commit", "--quiet", "-m", "fixture");
			seedReviewChange({ path: temp } as Workspace);
			expect(git("log", "-1", "--format=%B")).toContain("Refund behavior is unchanged.");
			const result = spawnSync(
				"node",
				["node_modules/@csark0812/skeleton/dist/cli.js", "review", "prepare", "--base", "main"],
				{ cwd: temp, encoding: "utf8" },
			);
			expect(result.status).toBe(0);
			expect(result.stdout).toContain("## Review guide: docs/billing/REVIEW.md");
			expect(result.stdout).toContain("- docs/billing.md (changed: src/billing/charge.ts)");
			expect(result.stdout).toContain("-export const MAX_RETRIES = 1;");
		} finally {
			rmSync(temp, { recursive: true, force: true });
		}
	});

	it("keeps the PostPrint-shaped fixture matched except for Skeleton metadata", () => {
		const root = join(ROOT, "tests/fixtures/efficacy/postprint-applications");
		const control = join(root, "control");
		const treatment = join(root, "package-head");
		const contract = "docs/developer/websocket.md";
		expect(plain(readFileSync(join(control, contract), "utf8"))).toBe(
			plain(readFileSync(join(treatment, contract), "utf8")),
		);
		for (const path of [
			"apps/backend/postprint/realtime/schemas.py",
			"apps/backend/postprint/papers/realtime/publish.py",
			"apps/client/src/websocket/projectUpdates.ts",
			"tspackages/websocket/src/realtime/realtime.gen.ts",
		])
			expect(readFileSync(join(control, path), "utf8")).toBe(
				readFileSync(join(treatment, path), "utf8"),
			);
		const catalog = readFileSync(join(treatment, ".skeleton/catalog.md"), "utf8");
		expect(catalog).toContain("Workspace document realtime protocol");
		const treatmentDocument = readFileSync(join(treatment, contract), "utf8");
		expect(treatmentDocument).toContain("apps/backend/postprint/realtime/schemas.py");
		expect(treatmentDocument).toContain("apps/client/src/websocket/projectUpdates.ts");
		expect(treatmentDocument).toContain("tspackages/websocket/src/realtime/realtime.gen.ts");
	});

	it("blocks a rename that breaks a linked symbol but not an edit beside the narrowed dependency", () => {
		const fixture = join(ROOT, "tests/fixtures/efficacy/doc-reference");
		const document = "docs/invoice-reminders.md";
		expect(plain(readFileSync(join(fixture, "control", document), "utf8"))).toBe(
			plain(readFileSync(join(fixture, "skeleton", document), "utf8")),
		);
		const temp = mkdtempSync(join(tmpdir(), "skeleton-doc-reference-"));
		const git = (...args: string[]) =>
			execFileSync("git", ["-c", "user.name=Test", "-c", "user.email=test@example.com", ...args], {
				cwd: temp,
			});
		const replace = (path: string, from: string, to: string) => {
			const absolute = join(temp, path);
			writeFileSync(absolute, readFileSync(absolute, "utf8").replaceAll(from, to));
		};
		// The packed CLI, so a missing runtime dependency cannot silently widen the selector.
		const validateStaged = (change: () => void) => {
			git("reset", "--hard", "--quiet");
			change();
			git("add", "-A");
			const result = spawnSync(
				"node",
				["node_modules/@csark0812/skeleton/dist/cli.js", "validate", "changed", "--staged"],
				{ cwd: temp, encoding: "utf8" },
			);
			return { passed: result.status === 0, output: `${result.stdout}${result.stderr}` };
		};
		const renameIn = (path: string) =>
			replace(path, "sendInvoiceReminder", "remindInvoiceRecipient");
		try {
			cpSync(join(fixture, "skeleton"), temp, { recursive: true });
			git("init", "--quiet", "-b", "main");
			git("add", "-A");
			git("commit", "--quiet", "-m", "fixture");
			const stale = validateStaged(() => renameIn("src/invoices.ts"));
			expect(stale.passed).toBe(false);
			expect(stale.output).toContain("no symbol sendInvoiceReminder");
			const repaired = validateStaged(() => {
				renameIn("src/invoices.ts");
				renameIn(document);
			});
			expect(repaired.passed).toBe(true);
			const unrelated = validateStaged(() =>
				replace("src/invoices.ts", "padStart(5", "padStart(6"),
			);
			expect(unrelated.output).not.toContain("review required");
			expect(unrelated.passed).toBe(true);
		} finally {
			rmSync(temp, { recursive: true, force: true });
		}
	}, 60_000);

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
