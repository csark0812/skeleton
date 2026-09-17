import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { attestDocuments } from "../src/audit/core/review-proof.ts";
import { buildCatalogContent } from "../src/catalog.ts";

const ROOT = join(import.meta.dir, "..");
const FIXTURES = join(ROOT, "tests/fixtures/efficacy");
const REVIEWED_AT = "2026-09-14";

rmSync(FIXTURES, { recursive: true, force: true });

function write(rel: string, contents: string): void {
	const abs = join(ROOT, rel);
	mkdirSync(dirname(abs), { recursive: true });
	writeFileSync(abs, contents);
}

function writeTree(root: string, files: Record<string, string>): void {
	for (const [rel, contents] of Object.entries(files)) write(join(root, rel), contents);
}

function skeletonConfig(includeCode = true): string {
	return `daysUntilStale = 365

[scan]
include = ["docs/**", "README.md", "AGENTS.md"]
exclude = []

[reviewProof]
mode = "hash"

[reviewCoverage]
include = ${includeCode ? '["src/**/*.ts"]' : "[]"}
exclude = ["tests/**"]

[deny]
paths = []
`;
}

function addSkeletonArtifacts(root: string, docsToAttest: string[]): void {
	const abs = join(ROOT, root);
	for (const doc of docsToAttest) {
		attestDocuments({ root: abs, paths: [doc], reviewedAt: REVIEWED_AT });
	}
	const { content } = buildCatalogContent(abs);
	write(join(root, ".skeleton/catalog.md"), content);
}

const packageJson = `{
	"name": "billing-service-fixture",
	"private": true,
	"type": "module",
	"scripts": {
		"test": "bun test"
	}
}
`;

const billingSource = `export const WEBHOOK_URL = "https://api.example.com/v1/billing/webhook";
export const MAX_RETRIES = 0;

export async function deliverBillingWebhook(send: () => Promise<boolean>): Promise<boolean> {
	for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
		if (await send()) return true;
	}
	return false;
}
`;

const billingTest = `import { expect, test } from "bun:test";
import { deliverBillingWebhook, MAX_RETRIES, WEBHOOK_URL } from "../src/billing";

test("uses the live webhook", () => {
	expect(WEBHOOK_URL).toBe("https://api.example.com/v1/billing/webhook");
});

test("does not retry failed delivery", async () => {
	let attempts = 0;
	await deliverBillingWebhook(async () => {
		attempts += 1;
		return false;
	});
	expect(MAX_RETRIES).toBe(0);
	expect(attempts).toBe(1);
});
`;

const billingDocPlain = `# Billing webhook delivery

The live endpoint is https://api.example.com/v1/billing/webhook.

Failed deliveries are not retried. The implementation is in \`src/billing.ts\`.
`;

const billingDocSkeleton = `# Billing webhook delivery

<!-- source-of-truth: Billing webhook endpoint and retry policy -->

<!-- doc-meta: owner=billing | last-reviewed=${REVIEWED_AT} -->

<!-- review-deps: paths=src/billing.ts -->

The live endpoint is https://api.example.com/v1/billing/webhook.

Failed deliveries are not retried. The implementation is in \`src/billing.ts\`.
`;

const controlAgents = `# Agent entry

Inspect the repository before answering. Treat source code as live behavior.
Keep the focused tests and the relevant documentation accurate when changing code.
`;

const driftCommon = {
	"README.md": "# Billing service\n\nWebhook delivery lives in src/billing.ts.\n",
	"package.json": packageJson,
	"src/billing.ts": billingSource,
	"tests/billing.test.ts": billingTest,
};

writeTree("tests/fixtures/efficacy/drift/control", {
	...driftCommon,
	"AGENTS.md": controlAgents,
	"docs/billing-webhooks.md": billingDocPlain,
});
writeTree("tests/fixtures/efficacy/drift/skeleton", {
	...driftCommon,
	"AGENTS.md": controlAgents,
	"docs/billing-webhooks.md": billingDocSkeleton,
	"skeleton.toml": skeletonConfig(),
});
addSkeletonArtifacts("tests/fixtures/efficacy/drift/skeleton", ["docs/billing-webhooks.md"]);

const conflictReadme = `# Billing repository

Two peer documents disagree about the webhook URL for new integrations.
Repository authority metadata, when present, decides which paper is canonical.
`;
const authorityAgents = `# Agent entry

Inspect the repository before answering. Cite the documents you use.
`;

function authorityPaper(options: { label: "A" | "B"; url: string; marked: boolean }): string {
	const marker = options.marked ? "<!-- source-of-truth: Billing webhook endpoint -->\n\n" : "";
	return `# Billing webhook reference ${options.label}

${marker}<!-- doc-meta: owner=billing | last-reviewed=${REVIEWED_AT} -->

New integrations send webhooks to ${options.url}.
`;
}

function writeConflictFixture(
	root: "unmarked" | "single-marker" | "duplicate-markers",
	markers: { a: boolean; b: boolean },
): void {
	const fixtureRoot = `tests/fixtures/efficacy/conflict/${root}`;
	writeTree(fixtureRoot, {
		"AGENTS.md": authorityAgents,
		"package.json": packageJson,
		"README.md": conflictReadme,
		"docs/billing-webhook-a.md": authorityPaper({
			label: "A",
			url: "https://api.example.com/v2/billing/webhook",
			marked: markers.a,
		}),
		"docs/billing-webhook-b.md": authorityPaper({
			label: "B",
			url: "https://api.example.com/v1/billing/webhook",
			marked: markers.b,
		}),
		"skeleton.toml": skeletonConfig(false),
	});
	addSkeletonArtifacts(fixtureRoot, ["docs/billing-webhook-a.md", "docs/billing-webhook-b.md"]);
}

writeConflictFixture("unmarked", { a: false, b: false });
writeConflictFixture("single-marker", { a: true, b: false });
writeConflictFixture("duplicate-markers", { a: true, b: true });

const efficiencyFacts: Record<string, { summary: string; body: string; source: string }> = {
	"docs/billing/delivery.md": {
		summary: "Billing webhook delivery ownership and retry limit",
		body: "Billing delivery allows MAX_RETRIES=1. The implementation owner is src/billing/delivery.ts.",
		source: "src/billing/delivery.ts",
	},
	"docs/billing/idempotency.md": {
		summary: "Billing webhook idempotency contract",
		body: "Every delivery uses the Idempotency-Key header. The implementation owner is src/billing/idempotency.ts.",
		source: "src/billing/idempotency.ts",
	},
	"docs/deployment/billing-rollout.md": {
		summary: "Billing webhook rollout flag",
		body: "The rollout flag is BILLING_WEBHOOK_V2. The implementation owner is src/deployment/billing-rollout.ts.",
		source: "src/deployment/billing-rollout.ts",
	},
	"docs/orders/cancellation.md": {
		summary: "Order cancellation inventory release",
		body: "Cancellation releases reserved inventory. The implementation owner is src/orders/cancellation.ts.",
		source: "src/orders/cancellation.ts",
	},
	"docs/orders/fulfillment.md": {
		summary: "Order fulfillment shipment event",
		body: "Fulfillment emits shipment.created. The implementation owner is src/orders/fulfillment.ts.",
		source: "src/orders/fulfillment.ts",
	},
	"docs/orders/returns.md": {
		summary: "Order return authorization requirement",
		body: "Returns require a merchandise authorization. The implementation owner is src/orders/returns.ts.",
		source: "src/orders/returns.ts",
	},
};

const noiseTopics = [
	["auth/session-cookies", "Session cookie rotation", "Sessions rotate after privilege changes."],
	["auth/service-accounts", "Service account access", "Service accounts use scoped credentials."],
	["auth/sso", "Single sign-on", "SSO metadata is refreshed daily."],
	["billing/invoices", "Invoice generation", "Invoices close at the end of the billing period."],
	["billing/refunds", "Refund processing", "Refunds retain the original payment reference."],
	["billing/tax", "Tax calculation", "Tax location comes from the billing address."],
	["deployment/canary", "Canary deployment", "Canaries receive five percent of traffic."],
	["deployment/rollback", "Deployment rollback", "Rollback uses the previous signed artifact."],
	["deployment/secrets", "Deployment secrets", "Secrets come from the runtime secret store."],
	["incidents/alerts", "Incident alerts", "Paging alerts require a runbook link."],
	["incidents/ownership", "Incident ownership", "The incident commander owns coordination."],
	["incidents/postmortems", "Incident postmortems", "Postmortems record corrective actions."],
	["platform/logging", "Platform logging", "Structured logs include a request identifier."],
	["platform/metrics", "Platform metrics", "Service metrics use stable low-cardinality labels."],
	["platform/queues", "Platform queues", "Queue consumers use bounded concurrency."],
	["users/deletion", "User deletion", "Deletion removes personal data after retention."],
	["users/preferences", "User preferences", "Preferences are versioned per account."],
	[
		"users/profiles",
		"User profiles",
		"Profiles store display names separately from login identity.",
	],
] as const;

type EfficiencyTreatment = "control" | "package";

function efficiencyFiles(treatment: EfficiencyTreatment): Record<string, string> {
	const skeleton = treatment === "package";
	const files: Record<string, string> = {
		"AGENTS.md": controlAgents,
		"README.md": "# Commerce service\n\nDocumentation covers Billing and adjacent service areas.\n",
		"src/billing/delivery.ts": "export const MAX_RETRIES = 1;\n",
		"src/billing/idempotency.ts": 'export const IDEMPOTENCY_HEADER = "Idempotency-Key";\n',
		"src/deployment/billing-rollout.ts":
			'export const BILLING_ROLLOUT_FLAG = "BILLING_WEBHOOK_V2";\n',
		"src/orders/cancellation.ts": "export const RELEASES_RESERVED_INVENTORY = true;\n",
		"src/orders/fulfillment.ts": 'export const SHIPMENT_EVENT = "shipment.created";\n',
		"src/orders/returns.ts": "export const RETURN_AUTHORIZATION_REQUIRED = true;\n",
	};
	for (const [path, fact] of Object.entries(efficiencyFacts)) {
		files[path] = skeleton
			? `# ${fact.summary}\n\n<!-- source-of-truth: ${fact.summary}; source owner ${fact.source} -->\n\n<!-- doc-meta: owner=eng | last-reviewed=${REVIEWED_AT} -->\n\n<!-- review-deps: paths=${fact.source} -->\n\n${fact.body}\n`
			: `# ${fact.summary}\n\n${fact.body}\n`;
	}
	for (const [slug, title, body] of noiseTopics)
		files[`docs/${slug}.md`] = `# ${title}\n\n${body}\n`;
	if (skeleton) files["skeleton.toml"] = skeletonConfig();
	return files;
}

writeTree("tests/fixtures/efficacy/efficiency/control", efficiencyFiles("control"));
writeTree("tests/fixtures/efficacy/efficiency/package-head", efficiencyFiles("package"));
addSkeletonArtifacts(
	"tests/fixtures/efficacy/efficiency/package-head",
	Object.keys(efficiencyFacts),
);

writeTree("tests/fixtures/efficacy/product-smoke/adopt-consumer", {
	"AGENTS.md": `# Agent entry\n\nInstall @csark0812/skeleton with npm, then initialize it in this repository. Stay inside this repository.\n`,
	"README.md": "# Notes app\n\nA small app with documentation but no Skeleton setup.\n",
	"docs/guide.md": "# Notes guide\n\nKeep each note under docs/. Use one file per topic.\n",
	"package.json": `{
	"name": "efficacy-adopt-consumer",
	"private": true,
	"type": "module",
	"devDependencies": {}
}\n`,
});

write(
	"tests/fixtures/efficacy/README.md",
	`# Efficacy fixtures

Generated by \`bun scripts/write-efficacy-fixtures.ts\`.

| Folder | Purpose |
| ------ | ------- |
| \`drift/control\` and \`drift/skeleton\` | Matched Billing service before a staged source drift patch. |
| \`conflict/unmarked\` | Two neutral peer papers with no authority marker. |
| \`conflict/single-marker\` | The same papers with one authority marker. |
| \`conflict/duplicate-markers\` | The same papers with both authority markers. |
| \`efficiency/control\` and \`efficiency/package-head\` | Matched repository question; package-head uses the current package. |
| \`product-smoke/adopt-consumer\` | Separate npm install and init smoke. |

The drift and package-head treatments receive the exact packed development package and the context guide produced by default initialization. Optional host skills are not installed. Product smoke enables sandbox network access and installs from npm. Generated vendor trees stay out of Git.
`,
);

console.log("wrote efficacy fixtures");
