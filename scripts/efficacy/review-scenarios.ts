import type { Workspace } from "@post-print/agent-test";
import { seedReviewNotifications } from "./review-notifications.ts";
import { seedReviewHeldOut, seedReviewHeldOutTwo, seedReviewReal } from "./review-real.ts";
import { seedReviewChange } from "./workspace.ts";

export type ReviewArm = "control" | "skeleton";

export type ReviewDefect = {
	/** What the judge must find in the report. */
	failure: string;
	/** An independent reading of one report line, which audits the judge on every run. */
	foundInLine: (line: string) => boolean;
};

export type ReviewScenario = {
	name: string;
	fixture: string;
	seed: (workspace: Workspace, arm: ReviewArm) => void;
	defects: Record<string, ReviewDefect>;
	/** A defect every working reviewer should find. Missing it means the run says nothing. */
	floor: string | null;
	/** A harmless change that must not be called important. */
	decoyPath: string | null;
};

const REFUTES_CLAIM = /(stated|intent|commit|contradict|claims?|despite|says)/i;

export const REVIEW_SCENARIOS = {
	payments: {
		name: "payments",
		fixture: "review-change",
		seed: seedReviewChange,
		floor: "generic",
		decoyPath: "src/orders/format.ts",
		defects: {
			generic: {
				failure:
					"src/orders/total.ts stops one line early, so the last order line is left out of the total.",
				foundInLine: (line) => line.includes("src/orders/total.ts"),
			},
			guideRule: {
				failure:
					"chargeSavedCard in src/billing/charge.ts charges without calling requireManualApproval.",
				foundInLine: (line) =>
					/requireManualApproval|manual approval|unapproved|skips? .*approval/i.test(line) &&
					/charge/i.test(line),
			},
			staleDoc: {
				failure:
					"docs/billing.md still says failed charges are retried once, while MAX_RETRIES is now 3.",
				foundInLine: (line) => line.includes("docs/billing.md"),
			},
			deletionGuide: {
				failure:
					"removing src/payouts/hold.ts, or the hold in src/api/payout-route.ts, drops the seven-day payout hold.",
				foundInLine: (line) => /hold/i.test(line) && /payout/i.test(line),
			},
			deletionRule: {
				failure:
					"the report says docs/payouts/hold-changes.md lacks the record that removing the hold requires. Reporting the removed hold alone does not count.",
				foundInLine: (line) => line.includes("hold-changes"),
			},
			intentMismatch: {
				failure:
					"src/billing/refund.ts changes refund rounding although the commit message says refund behavior is unchanged. The report must name that contradiction; reporting the rounding change alone does not count.",
				foundInLine: (line) => /refund/i.test(line) && REFUTES_CLAIM.test(line),
			},
		},
	},
	notifications: {
		name: "notifications",
		fixture: "review-notifications",
		seed: seedReviewNotifications,
		floor: "generic",
		decoyPath: "src/notify/format.py",
		defects: {
			generic: {
				failure: "src/notify/quiet_hours.py changes >= to >, so hour 22 is no longer quiet.",
				foundInLine: (line) => line.includes("quiet_hours.py"),
			},
			guideRule: {
				failure: "send_sms in src/notify/send.py delivers without calling require_opt_in.",
				foundInLine: (line) => /send_sms|send\.py/.test(line) && /opt.?in/i.test(line),
			},
			staleDoc: {
				failure:
					"docs/notify.md still says digests go out every 24 hours, while DIGEST_HOURS is now 6.",
				foundInLine: (line) => line.includes("docs/notify.md"),
			},
			deletionGuide: {
				failure:
					"removing src/audit/retention.py, or the expiry in src/notify/log.py, drops the 90-day audit retention.",
				foundInLine: (line) => /retention|expir/i.test(line) && /audit|log\.py/i.test(line),
			},
			deletionRule: {
				failure:
					"the report says docs/audit/retention-changes.md lacks the record that removing retention requires. Reporting the removed retention alone does not count.",
				foundInLine: (line) => line.includes("retention-changes"),
			},
			intentMismatch: {
				failure:
					"src/notify/unsubscribe.py makes token matching case-insensitive although the commit message says unsubscribe behavior is unchanged. The report must name that contradiction; reporting the matching change alone does not count.",
				foundInLine: (line) => /unsubscribe/i.test(line) && REFUTES_CLAIM.test(line),
			},
		},
	},
	real: {
		name: "real",
		fixture: "review-real",
		seed: seedReviewReal,
		floor: null,
		decoyPath: null,
		defects: {
			regression: {
				failure:
					"src/audit/core/review-proof.ts now hashes package.json byte for byte, so a release version bump invalidates the review of every document that depends on package.json. Count only a finding at src/audit/core/review-proof.ts, as important or decision. A finding only at a document does not count, even when it describes this consequence.",
				foundInLine: (line) =>
					line.includes("src/audit/core/review-proof.ts") &&
					/package\.json|manifest/i.test(line) &&
					/version|release/i.test(line),
			},
			legacyProof: {
				failure:
					"digests already recorded for package.json by the removed rule no longer match, so existing review proof reads as changed.",
				foundInLine: (line) =>
					/(digest|hash|proof|lock)/i.test(line) && /(existing|recorded|already)/i.test(line),
			},
			staleDoc: {
				failure:
					"a document such as docs/developer/audit.md or docs/developer/config.md still says package.json is compared without its version. The report must name the document.",
				foundInLine: (line) =>
					/docs\/|README\.md|operations\.md/.test(line) && /package\.json|version/i.test(line),
			},
		},
	},
	/** A second real fix, held out from all contract tuning. Its answer key was written from the fix. */
	heldout: {
		name: "heldout",
		fixture: "review-real",
		seed: seedReviewHeldOut,
		floor: null,
		decoyPath: null,
		defects: {
			regression: {
				failure:
					"under --base, validate changed compares last-reviewed with today's UTC date instead of the date of the latest commit in the range that touched the dependency, so the same commit range passes before 00:00 UTC and fails after it with no source change. Count only a finding at src/validate/changed.ts or src/validate/git-diff.ts, as important or decision. A finding only at a document does not count, even when it describes this consequence.",
				foundInLine: (line) =>
					/src\/validate\/(changed|git-diff)\.ts/.test(line) &&
					/(utc|today|midnight|clock|date|day)/i.test(line) &&
					/(--base|base|range|ci|determin|re-?run)/i.test(line),
			},
			staleDoc: {
				failure:
					"a document such as docs/developer/validation.md, docs/developer/troubleshooting.md, or docs/developer/config.md still says that under --base the review date only has to be on or after the latest commit in the range, so the same range gives the same result on any day. The report must name the document.",
				foundInLine: (line) =>
					/docs\/|README\.md|operations\.md/.test(line) &&
					/(--base|base|commit|range|utc|day)/i.test(line),
			},
			testsRemoved: {
				failure:
					"src/__tests__/cli/validate-hook.test.ts loses the tests that pinned --base results across UTC midnight.",
				foundInLine: (line) => line.includes("validate-hook.test.ts"),
			},
		},
	},
	/** A third real fix, held out from all tuning. Its answer key was written from the fix. */
	heldout2: {
		name: "heldout2",
		fixture: "review-real",
		seed: seedReviewHeldOutTwo,
		floor: null,
		decoyPath: null,
		defects: {
			regression: {
				failure:
					"src/audit/core/review-coverage.ts adds **/*.mjs to the default review-coverage excludes, so every production .mjs file drops out of review coverage and an uncovered .mjs change passes validate changed. Count only a finding at src/audit/core/review-coverage.ts, as important or decision.",
				foundInLine: (line) =>
					line.includes("src/audit/core/review-coverage.ts") && /\.?mjs/i.test(line),
			},
			staleDoc: {
				failure:
					"docs/developer/config.md still says production .mjs stays in the coverage set and that the built-in excludes only drop tests, fixtures, templates, and .skeleton/plugins/**. The report must name the document.",
				foundInLine: (line) => line.includes("docs/developer/config.md"),
			},
			testsRemoved: {
				failure:
					"the tests that kept production .mjs as a coverage candidate are deleted from src/audit/__tests__/review-coverage.test.ts or src/__tests__/cli/validate-hook.test.ts.",
				foundInLine: (line) => /review-coverage\.test\.ts|validate-hook\.test\.ts/.test(line),
			},
		},
	},
} satisfies Record<string, ReviewScenario>;
