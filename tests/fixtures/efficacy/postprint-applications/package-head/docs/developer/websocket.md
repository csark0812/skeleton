# Workspace document realtime

<!-- source-of-truth: Workspace document realtime protocol, generated client, and cache invalidation boundaries -->

<!-- doc-meta: owner=eng | last-reviewed=2026-09-14 -->

<!-- review-deps: paths=apps/backend/postprint/realtime/schemas.py,apps/backend/postprint/papers/realtime/publish.py,tspackages/websocket/src/realtime/realtime.gen.ts,apps/client/src/websocket/projectUpdates.ts,apps/backend/postprint/realtime/openapi_ws.json,tspackages/websocket/project.json,tspackages/websocket/scripts/generate-types.ts -->

Workspace document events cross the backend schema, generated WebSocket client, web-client
cache handler, and this developer contract.

The backend envelope and event payload are owned by
`apps/backend/postprint/realtime/schemas.py`. Workspace document publication is owned by
`apps/backend/postprint/papers/realtime/publish.py` and occurs only after the surrounding
database transaction commits.

Generated TypeScript lives in `tspackages/websocket/src/realtime/realtime.gen.ts`. Do not edit
that file by hand; after changing the backend schema, run `bun run generate-clients`.

The web client handles `workspace.document_updated` in
`apps/client/src/websocket/projectUpdates.ts`. It invalidates the project document list,
document detail, document content, and workspace folder queries.

This is the complete contract map for a read-only impact analysis. Inspect additional paths only
when implementing a change or diagnosing a failed generation run.
