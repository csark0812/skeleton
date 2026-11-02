import { describe, expect, it } from "bun:test";
import { execFileSync, spawnSync } from "node:child_process";
import {
	chmodSync,
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
import process from "node:process";
import type { Workspace } from "@post-print/agent-test";
import { checkBillingDocument } from "../../scripts/efficacy/billing-document.ts";
import { HISTORY_TASKS } from "../../scripts/efficacy/history.ts";
import { median } from "../../scripts/efficacy/median.ts";
import {
	behaviorMix,
	bundleUseByFixture,
	defectComparison,
	directionalStability,
	type FixtureResult,
	featureVerdict,
	keptContractFormat,
	mcnemarExact,
	recallDifference,
	receivedBundle,
	reliabilityChecks,
	replicationCheck,
	sensitivity,
	sessionInterval,
	sessionReport,
	splitHalfAgreement,
	tokenRatio,
} from "../../scripts/efficacy/review-analysis.ts";
import {
	BUNDLE_PROMPT_LEAD,
	reviewBundlePrompt,
} from "../../scripts/efficacy/review-bundle-prompt.ts";
import {
	decoyNotImportant,
	detectionSchema,
	judgeReport,
	summarizeDetection,
	textChecks,
} from "../../scripts/efficacy/review-detection.ts";
import { seedReviewNotifications } from "../../scripts/efficacy/review-notifications.ts";
import { seedReviewReal } from "../../scripts/efficacy/review-real.ts";
import { REVIEW_SCENARIOS } from "../../scripts/efficacy/review-scenarios.ts";
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
			deletionRule: false,
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

	it("fails the decoy only when a report calls the rename important", () => {
		const decoy = "src/orders/format.ts";
		expect(
			decoyNotImportant("important\tsrc/orders/total.ts:3\toff by one\tDrops a line.", decoy),
		).toBe(true);
		expect(decoyNotImportant("nit\tsrc/orders/format.ts:2\tnaming\tRenamed.", decoy)).toBe(true);
		expect(decoyNotImportant("important\tsrc/orders/format.ts:2\tnaming\tRenamed.", decoy)).toBe(
			false,
		);
	});

	it("asks the judge again when it gives no verdict, up to a limit", async () => {
		const schema = detectionSchema(REVIEW_SCENARIOS.real);
		const answering =
			(...answers: string[]) =>
			async () =>
				schema.parse(JSON.parse(answers.shift() ?? ""));
		const verdict = JSON.stringify({
			regression: true,
			legacyProof: false,
			staleDoc: false,
			otherImportant: 0,
			reason: "Found.",
		});
		const schemaEcho = JSON.stringify({ type: "object", properties: {} });

		expect((await judgeReport(answering(schemaEcho, verdict), 0)).reason).toBe("Found.");
		expect((await judgeReport(answering("not JSON", schemaEcho, verdict), 0)).reason).toBe(
			"Found.",
		);
		await expect(
			judgeReport(answering(schemaEcho, schemaEcho, schemaEcho, verdict), 0),
		).rejects.toThrow();

		let calls = 0;
		await expect(
			judgeReport(async () => {
				calls++;
				throw new Error("provider failure");
			}, 0),
		).rejects.toThrow("provider failure");
		expect(calls).toBe(3);
	});

	it("reads each defect directly from a report, to audit the judge", () => {
		const found = textChecks(
			REVIEW_SCENARIOS.notifications,
			"important\tdocs/notify.md:3\tstale\tSays 24 hours.\nimportant\tsrc/notify/send.py:9\trule\tsend_sms skips require_opt_in.",
		);
		expect(found).toMatchObject({
			staleDoc: true,
			guideRule: true,
			generic: false,
			intentMismatch: false,
		});
	});

	describe("review comparison statistics", () => {
		const run = (found: boolean, tokens = 100) => ({
			found: { defect: found },
			tokens,
			usedBundle: true,
			keptFormat: false,
			toolCalls: 1,
		});
		const fixture = (
			fixtureName: string,
			wins: number,
			ties: number,
			losses = 0,
		): FixtureResult => ({
			fixture: fixtureName,
			defects: ["defect"],
			pairs: [
				...Array.from({ length: wins }, () => ({
					baseline: run(false),
					withSkeleton: run(true, 50),
				})),
				...Array.from({ length: ties }, () => ({
					baseline: run(true),
					withSkeleton: run(true, 50),
				})),
				...Array.from({ length: losses }, () => ({
					baseline: run(true),
					withSkeleton: run(false, 50),
				})),
			],
		});

		it("computes the exact McNemar probability", () => {
			expect(mcnemarExact(0, 0)).toBe(1);
			expect(mcnemarExact(5, 0)).toBeCloseTo(0.0625, 6);
			expect(mcnemarExact(10, 0)).toBeCloseTo(2 * 0.5 ** 10, 8);
			expect(mcnemarExact(3, 3)).toBe(1);
		});

		it("gives the same interval every time and weighs fixtures equally", () => {
			const fixtures = [fixture("a", 10, 10), fixture("b", 0, 4)];
			expect(recallDifference(fixtures)).toEqual(recallDifference(fixtures));
			expect(recallDifference(fixtures).estimate).toBeCloseTo(0.25, 6);
			expect(tokenRatio(fixtures).estimate).toBeCloseTo(0.5, 6);
		});

		it("reaches each verdict only when the interval supports it", () => {
			expect(featureVerdict([fixture("a", 12, 8), fixture("b", 12, 8)])).toBe("helps");
			expect(featureVerdict([fixture("a", 0, 40), fixture("b", 0, 40)])).toBe(
				"no-meaningful-effect",
			);
			expect(featureVerdict([fixture("a", 3, 14, 3), fixture("b", 3, 14, 3)])).toBe("inconclusive");
			expect(featureVerdict([fixture("a", 20, 0), fixture("b", 0, 2, 18)])).toBe("mixed");
		});

		it("does not let a costly win count as helping", () => {
			const costly = fixture("a", 15, 5);
			for (const pair of costly.pairs) pair.withSkeleton.tokens = 200;
			expect(featureVerdict([costly])).toBe("inconclusive");
		});

		it("fails the instrument on a noisy null round, whichever side wins", () => {
			const fixtures = [fixture("a", 20, 0), fixture("b", 20, 0)];
			const evidence = {
				assessedFraction: { a: 1, b: 1 },
				judgeTextAgreement: 1,
				bundleUse: { a: 1, b: 1 },
				nullRound: fixture("null", 0, 40),
			};
			expect(Object.values(reliabilityChecks(fixtures, evidence)).every(Boolean)).toBe(true);
			expect(reliabilityChecks(fixtures, evidence).sensitivity).toBe(true);
			const noisy = reliabilityChecks(fixtures, {
				...evidence,
				nullRound: fixture("null", 6, 8, 6),
			});
			expect(noisy.nullCoversZero).toBe(true);
			expect(noisy.nullIsTight).toBe(false);
			const biased = reliabilityChecks(fixtures, {
				...evidence,
				nullRound: fixture("null", 15, 5),
			});
			expect(biased.nullCoversZero).toBe(false);
			expect(
				reliabilityChecks(fixtures, { ...evidence, bundleUse: { a: 1, b: 0 } }).bundleUse,
			).toBe(false);
			expect(reliabilityChecks(fixtures, { ...evidence, nullRound: null }).nullCoversZero).toBe(
				false,
			);
		});

		it("requires stability only where a direction is claimed", () => {
			expect(directionalStability([fixture("none", 5, 10, 5)])).toEqual([]);
			expect(
				directionalStability([fixture("clear", 18, 2), fixture("none", 5, 10, 5)]),
			).toContainEqual({
				claim: "clear",
				agreement: 1,
			});
		});

		it("sees a known effect through ordinary spread, but not through a very wide one", () => {
			expect(
				sensitivity([fixture("ordinary", 1, 38, 1), fixture("other", 1, 38, 1)]),
			).toBeGreaterThan(0.9);
			expect(sensitivity([fixture("wide", 3, 0, 3)])).toBeLessThan(0.9);
		});

		it("computes a t interval with the session as the unit", () => {
			const interval = sessionInterval([-0.039, -0.033, 0.017]);
			expect(interval.estimate).toBeCloseTo(-0.0183, 3);
			expect(interval.low).toBeCloseTo(-0.0948, 3);
			expect(interval.high).toBeCloseTo(0.0581, 3);
			expect(() => sessionInterval([0.1])).toThrow();
		});

		it("counts the bundle as used only when a tool result delivered it", () => {
			expect(receivedBundle(["# Review bundle\n\n## Reviewer contract\n"])).toBe(true);
			expect(receivedBundle(["npm error code EPERM", undefined])).toBe(false);
			expect(keptContractFormat("important\ta.ts:1\tbug\twhy\nfindings: 1 important")).toBe(true);
			expect(keptContractFormat("important\ta.ts:1\tbug\tno findings: here")).toBe(false);
		});

		it("fails a session whose one fixture never delivered the bundle", () => {
			const undelivered = fixture("real", 10, 0);
			undelivered.pairs = undelivered.pairs.map((pair) => ({
				...pair,
				withSkeleton: { ...pair.withSkeleton, usedBundle: false },
			}));
			const fixtures = [fixture("a", 10, 0), undelivered];
			expect(bundleUseByFixture(fixtures)).toEqual({ a: 1, real: 0 });
			const days = ["d1", "d1", "d2", "d2", "d3"];
			const report = sessionReport(
				days.map((day) => ({ day, fixtures, nullRound: fixture("null", 0, 20) })),
			);
			expect(report.bars.bundleDelivered).toBe(false);
		});

		it("reports recall for each behavior among runs that received the bundle", () => {
			const pair = (keptFormat: boolean, found: boolean, usedBundle = true) => ({
				baseline: run(true),
				withSkeleton: { ...run(found), keptFormat, usedBundle },
			});
			const mixed: FixtureResult = {
				fixture: "a",
				defects: ["defect"],
				pairs: [pair(true, true), pair(false, false), pair(false, true), pair(true, true, false)],
			};
			expect(behaviorMix([mixed])).toEqual({
				keptFormat: 1 / 3,
				keptRuns: 1,
				notKeptRuns: 2,
				recallWhenKept: 1,
				recallWhenNot: 0.5,
				baselineRecall: 1,
			});
		});

		it("judges each behavior only across sessions with enough of its runs", () => {
			const behaving = (kept: number, found: boolean): FixtureResult => ({
				fixture: "a",
				defects: ["defect"],
				pairs: Array.from({ length: 12 }, (_, index) => ({
					baseline: run(true),
					withSkeleton: { ...run(found), keptFormat: index < kept },
				})),
			});
			const report = (values: FixtureResult[]) =>
				sessionReport(
					values.map((a) => ({ day: "d", fixtures: [a], nullRound: fixture("n", 0, 9) })),
				);
			const steady = report([behaving(12, true), behaving(12, true), behaving(0, true)]);
			expect(steady.behaviorRecall.kept?.estimate).toBe(1);
			expect(steady.behaviorRecall.notKept).toBeNull();
			expect(steady.bars.behaviorsTight).toBe(true);
			const swinging = report([behaving(12, true), behaving(12, false), behaving(12, true)]);
			expect(swinging.bars.behaviorsTight).toBe(false);
			expect(report([behaving(5, true), behaving(5, true)]).bars.behaviorsTight).toBe(false);
		});

		it("fails session bars when sessions disagree, even if each session looks certain", () => {
			const session = (day: string, wins: number, losses: number) => ({
				day,
				fixtures: [fixture("a", wins, 20 - wins - losses, losses)],
				nullRound: fixture("null", 0, 20),
			});
			const agreeing = sessionReport(
				["d1", "d1", "d2", "d2", "d3"].map((day, index) => session(day, 10 + (index % 2), 0)),
			);
			expect(agreeing.verdict).toBe("helps");
			expect(Object.values(agreeing.bars).every(Boolean)).toBe(true);
			const disagreeing = sessionReport(
				["d1", "d1", "d2", "d2", "d3"].map((day, index) =>
					index % 2 ? session(day, 16, 0) : session(day, 0, 16),
				),
			);
			expect(disagreeing.verdict).toBe("inconclusive");
			expect(disagreeing.bars.tight).toBe(false);
			expect(sessionReport([session("d1", 10, 0), session("d1", 11, 0)]).bars.enoughSessions).toBe(
				false,
			);
		});

		it("passes replication only inside the first interval and with the same verdict", () => {
			const first = [fixture("a", 8, 8, 4), fixture("b", 8, 8, 4)];
			expect(replicationCheck(first, first).passed).toBe(true);
			expect(replicationCheck(first, [fixture("a", 0, 0, 20), fixture("b", 8, 8, 4)]).passed).toBe(
				false,
			);
			expect(() => replicationCheck(first, [fixture("a", 8, 8, 4)])).toThrow("missing b");
		});

		it("reports split-half agreement and per-defect counts", () => {
			expect(splitHalfAgreement([fixture("a", 20, 0)])).toBe(1);
			expect(splitHalfAgreement([fixture("a", 10, 0, 10)])).toBeLessThan(0.95);
			expect(defectComparison(fixture("a", 5, 2, 1))).toEqual([
				{ defect: "defect", skeleton: 7, baseline: 3, p: mcnemarExact(5, 1) },
			]);
		});
	});

	it("commits the notification defects on both sides and bundles their evidence", () => {
		const root = join(ROOT, "tests/fixtures/efficacy/review-notifications");
		const temp = mkdtempSync(join(tmpdir(), "skeleton-review-notify-"));
		const git = (...args: string[]) => execFileSync("git", args, { cwd: temp, encoding: "utf8" });
		try {
			cpSync(join(root, "skeleton"), temp, { recursive: true });
			git("init", "--quiet", "-b", "main");
			git("config", "user.email", "fixture@example.com");
			git("config", "user.name", "Fixture");
			git("add", "-A");
			git("commit", "--quiet", "-m", "fixture");
			seedReviewNotifications({ path: temp } as Workspace);
			const result = spawnSync(
				"node",
				["node_modules/@csark0812/skeleton/dist/cli.js", "review", "prepare", "--base", "main"],
				{ cwd: temp, encoding: "utf8" },
			);
			expect(result.status).toBe(0);
			expect(result.stdout).toContain("## Review guide: docs/notify/REVIEW.md");
			expect(result.stdout).toContain("## Review guide: docs/audit/REVIEW.md");
			expect(result.stdout).toContain("- docs/notify.md (changed: src/notify/digest.py)");
			expect(result.stdout).toContain("Unsubscribe behavior is unchanged.");
		} finally {
			rmSync(temp, { recursive: true, force: true });
		}
		for (const path of ["docs/notify.md", "docs/notify/REVIEW.md", "docs/audit/REVIEW.md"])
			expect(plain(readFileSync(join(root, "control", path), "utf8"))).toBe(
				plain(readFileSync(join(root, "skeleton", path), "utf8")),
			);
		expect(existsSync(join(root, "control/skeleton.toml"))).toBe(false);
	});

	it("reverts the real fix on a real snapshot and hides Skeleton from the bare-diff side", () => {
		for (const arm of ["control", "skeleton"] as const) {
			const temp = mkdtempSync(join(tmpdir(), `skeleton-review-real-${arm}-`));
			const git = (...args: string[]) => execFileSync("git", args, { cwd: temp, encoding: "utf8" });
			try {
				cpSync(join(ROOT, "tests/fixtures/efficacy/review-real", arm), temp, { recursive: true });
				git("init", "--quiet", "-b", "main");
				git("config", "user.email", "fixture@example.com");
				git("config", "user.name", "Fixture");
				writeFileSync(join(temp, ".gitignore"), "node_modules\n");
				git("add", "-A");
				git("commit", "--quiet", "-m", "fixture");
				seedReviewReal({ path: temp } as Workspace, arm);
				const diff = git("diff", "main...HEAD", "--", "src/audit/core/review-proof.ts");
				expect(diff).toContain("-function isPackageManifest");
				expect(existsSync(join(temp, "skeleton.toml"))).toBe(arm === "skeleton");
				const audit = readFileSync(join(temp, "docs/developer/audit.md"), "utf8");
				expect(audit.includes("review-deps:")).toBe(arm === "skeleton");
				if (arm === "skeleton") {
					// The same command the reviewer is told to run, where npm's cache cannot be created.
					const readOnlyHome = join(temp, "node_modules/.read-only-home");
					mkdirSync(readOnlyHome);
					chmodSync(readOnlyHome, 0o555);
					const result = spawnSync(
						"npx",
						["--no-install", "skeleton", "review", "prepare", "--base", "main"],
						{ cwd: temp, encoding: "utf8", env: { ...process.env, HOME: readOnlyHome } },
					);
					chmodSync(readOnlyHome, 0o755);
					expect(result.status).toBe(0);
					expect(receivedBundle([result.stdout])).toBe(true);
					expect(result.stdout).toContain(
						"docs/developer/audit.md (changed: src/audit/core/review-proof.ts)",
					);
				}
			} finally {
				rmSync(temp, { recursive: true, force: true });
			}
		}
	});

	it("gives the Skeleton reviewer the bundle as its prompt, the same for every run", () => {
		const prompt = reviewBundlePrompt(REVIEW_SCENARIOS.payments);
		expect(prompt.startsWith(`${BUNDLE_PROMPT_LEAD}\n\n# Review bundle (main...HEAD)`)).toBe(true);
		expect(receivedBundle([prompt])).toBe(true);
		expect(prompt).toContain("## Review guide: docs/billing/REVIEW.md");
		// The bundle's contract is the only instruction about the report format.
		expect(prompt).not.toContain("Start by running");
		expect(reviewBundlePrompt(REVIEW_SCENARIOS.payments)).toBe(prompt);
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
		for (const path of [
			"docs/billing.md",
			"docs/billing/REVIEW.md",
			"docs/payouts/REVIEW.md",
			"docs/payouts/hold-changes.md",
		])
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
			expect(result.stdout).toContain("## Review guide: docs/payouts/REVIEW.md");
			expect(result.stdout).toContain("docs/payouts/hold-changes.md");
			expect(result.stdout).toContain("Open the document and cite its own path and line.");
			expect(result.stdout).toContain("This bundle replaces `skeleton context`");
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
