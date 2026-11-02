import type { Workspace } from "@post-print/agent-test";
import { seedReviewNotifications } from "./review-notifications.ts";
import { seedReviewReal } from "./review-real.ts";
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
					"src/audit/core/review-proof.ts now hashes package.json byte for byte, so a release version bump invalidates the review of every document that depends on package.json.",
				foundInLine: (line) =>
					/package\.json|manifest/i.test(line) && /version|release/i.test(line),
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
} satisfies Record<string, ReviewScenario>;
