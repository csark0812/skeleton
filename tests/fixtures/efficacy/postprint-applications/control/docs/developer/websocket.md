# Workspace document realtime

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
