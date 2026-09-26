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

const postPrintRealtimeDoc = `# Workspace document realtime

Workspace document events cross the backend schema, generated WebSocket client, web-client
cache handler, and this developer contract.

The backend envelope and event payload are owned by
\`apps/backend/postprint/realtime/schemas.py\`. Workspace document publication is owned by
\`apps/backend/postprint/papers/realtime/publish.py\` and occurs only after the surrounding
database transaction commits.

Generated TypeScript lives in \`tspackages/websocket/src/realtime/realtime.gen.ts\`. Do not edit
that file by hand; after changing the backend schema, run \`bun run generate-clients\`.

The web client handles \`workspace.document_updated\` in
\`apps/client/src/websocket/projectUpdates.ts\`. It invalidates the project document list,
document detail, document content, and workspace folder queries.

This is the complete contract map for a read-only impact analysis. Inspect additional paths only
when implementing a change or diagnosing a failed generation run.
`;

const postPrintRealtimeSources: Record<string, string> = {
	"apps/backend/postprint/realtime/schemas.py": `from typing import Literal

from pydantic import BaseModel


class WorkspaceDocumentUpdatedData(BaseModel):
    document_id: str
    project_id: str
    event: Literal["workspace.document_updated"] = "workspace.document_updated"
`,
	"apps/backend/postprint/papers/realtime/publish.py": `def publish_document_updated(*, transaction, document_id: str, project_id: str) -> None:
    transaction.on_commit(
        lambda: broadcast("workspace.document_updated", {"document_id": document_id, "project_id": project_id})
    )
`,
	"tspackages/websocket/src/realtime/realtime.gen.ts": `// Generated from the backend AsyncAPI schema. Do not edit by hand.
export type WorkspaceDocumentUpdated = {
	event: "workspace.document_updated";
	document_id: string;
	project_id: string;
};
`,
	"apps/client/src/websocket/projectUpdates.ts": `const documentUpdateInvalidations = [
	"projectDocuments",
	"documentDetail",
	"documentContent",
	"workspaceFolders",
] as const;

export const projectUpdateHandlers = {
	"workspace.document_updated": documentUpdateInvalidations,
};
`,
	"apps/backend/postprint/realtime/openapi_ws.json":
		'{"asyncapi":"3.0.0","info":{"title":"PostPrint realtime","version":"1.0.0"}}\n',
	"tspackages/websocket/project.json": `{
	"name": "websocket",
	"targets": {
		"generate": {
			"command": "bun tspackages/websocket/scripts/generate-types.ts"
		}
	}
}
`,
	"tspackages/websocket/scripts/generate-types.ts": `import { readFileSync, writeFileSync } from "node:fs";

const schemaPath = "apps/backend/postprint/realtime/openapi_ws.json";
const outputPath = "tspackages/websocket/src/realtime/realtime.gen.ts";
const schema = JSON.parse(readFileSync(schemaPath, "utf8"));
if (schema.info?.title !== "PostPrint realtime") throw new Error("Unexpected realtime schema");
const generated = \`// Generated from the backend AsyncAPI schema. Do not edit by hand.
export type WorkspaceDocumentUpdated = {
\\tevent: "workspace.document_updated";
\\tdocument_id: string;
\\tproject_id: string;
};
\`;
writeFileSync(outputPath, generated);
`,
};

const postPrintNoiseDocs = [
	["docs/developer/api-clients.md", "API clients", "REST clients are generated from OpenAPI."],
	[
		"docs/developer/architecture.md",
		"Architecture",
		"Applications and packages share one workspace.",
	],
	["docs/developer/builds.md", "Builds", "Nx owns package build targets."],
	[
		"docs/developer/services.md",
		"Services",
		"Local services are coordinated by the runtime script.",
	],
	["docs/developer/surfaces.md", "Surfaces", "Each application documents its development command."],
	[
		"docs/domain/documents.md",
		"Documents",
		"Documents belong to projects and may live in folders.",
	],
	["docs/domain/projects.md", "Projects", "Projects contain sources and Workspace files."],
	["docs/operations/deployments.md", "Deployments", "Deployments promote signed images."],
	[
		"docs/operations/observability.md",
		"Observability",
		"Structured logs carry request identifiers.",
	],
	["docs/product/workspace.md", "Workspace", "Workspace supports documents and folders."],
	[
		"docs/security/application.md",
		"Application security",
		"WebSocket subscriptions require authorization.",
	],
	[
		"docs/security/review.md",
		"Security review",
		"Review authentication and data exposure boundaries.",
	],
] as const;

const postPrintNoiseSources: Record<string, string> = {
	"apps/backend/postprint/notifications/realtime/events.py":
		'NOTIFICATION_EVENT = "notification.created"\n',
	"apps/backend/postprint/organizations/realtime/events.py":
		'ORGANIZATION_EVENT = "organization.updated"\n',
	"apps/backend/postprint/papers/api/schemas/document_schema.py":
		"class DocumentSchema:\n    pass\n",
	"apps/backend/postprint/papers/services/documents.py": "def update_document():\n    pass\n",
	"apps/backend/postprint/realtime/consumers.py": "class RealtimeConsumer:\n    pass\n",
	"apps/client/src/api/websocket.ts": 'export const REALTIME_PATH = "/ws/realtime/";\n',
	"apps/client/src/components/library/WebsiteProjectDocumentPage.tsx":
		"export function WebsiteProjectDocumentPage() { return null; }\n",
	"apps/client/src/websocket/notifications.ts":
		'export const notificationEvent = "notification.created";\n',
	"apps/client/src/websocket/sources.ts": 'export const sourceEvent = "source.updated";\n',
	"tspackages/api-client/src/client.gen.ts": "// Generated REST client.\n",
	"tspackages/query/src/projects/realtime.ts": 'export const projectEvent = "project.updated";\n',
	"tspackages/query/src/sources/cache/realtimeUtils.ts":
		"export const invalidateSourceQueries = () => undefined;\n",
	"tspackages/websocket/src/socket/RealtimeWebSocket.ts": "export class RealtimeWebSocket {}\n",
};

function postPrintFixtureFiles(treatment: EfficiencyTreatment): Record<string, string> {
	const skeleton = treatment === "package";
	const canonicalDoc = skeleton
		? `# Workspace document realtime

<!-- source-of-truth: Workspace document realtime protocol, generated client, and cache invalidation boundaries -->

<!-- doc-meta: owner=eng | last-reviewed=${REVIEWED_AT} -->

<!-- review-deps: paths=${Object.keys(postPrintRealtimeSources).join(",")} -->

${postPrintRealtimeDoc.replace(/^# Workspace document realtime\n+/, "")}`
		: postPrintRealtimeDoc;
	const files: Record<string, string> = {
		"AGENTS.md": controlAgents,
		"README.md":
			"# Applications monorepo\n\nDjango, React, and shared TypeScript packages live in one Nx workspace.\n",
		"package.json": `{
	"name": "postprint-shaped-applications-fixture",
	"private": true,
	"type": "module",
	"workspaces": ["apps/*", "tspackages/*"],
	"scripts": {
		"test": "bun test",
			"generate-clients": "bun tspackages/websocket/scripts/generate-types.ts",
		"validate:changed": "bun scripts/validate-changed.ts"
	}
}
`,
		"nx.json": '{"plugins": [], "targetDefaults": {"test": {"cache": true}}}\n',
		"docs/developer/websocket.md": canonicalDoc,
		"scripts/validate-changed.ts": 'console.log("validated changed files");\n',
		...postPrintRealtimeSources,
		...postPrintNoiseSources,
	};
	for (const [path, title, body] of postPrintNoiseDocs) files[path] = `# ${title}\n\n${body}\n`;
	if (skeleton)
		files["skeleton.toml"] = `daysUntilStale = 365

[scan]
include = ["docs/**", "README.md", "AGENTS.md"]
exclude = []

[reviewProof]
mode = "hash"

[reviewCoverage]
include = ["apps/**/*.py", "apps/**/*.ts", "apps/**/*.tsx", "tspackages/**/*.ts"]
exclude = ["**/tests/**", "**/*.test.ts"]

[deny]
paths = []
`;
	return files;
}

writeTree(
	"tests/fixtures/efficacy/postprint-applications/control",
	postPrintFixtureFiles("control"),
);
writeTree(
	"tests/fixtures/efficacy/postprint-applications/package-head",
	postPrintFixtureFiles("package"),
);
addSkeletonArtifacts("tests/fixtures/efficacy/postprint-applications/package-head", [
	"docs/developer/websocket.md",
]);

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
| \`postprint-applications/control\` and \`postprint-applications/package-head\` | Matched PostPrint-shaped monorepo question spanning backend, client, shared packages, and docs. |
| \`product-smoke/adopt-consumer\` | Separate npm install and init smoke. |

The drift and package-head treatments receive the exact packed development package and the context guide produced by default initialization. Optional host skills are not installed. Product smoke enables sandbox network access and installs from npm. Generated vendor trees stay out of Git.
`,
);

console.log("wrote efficacy fixtures");
