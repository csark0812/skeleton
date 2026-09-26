import { readFileSync, writeFileSync } from "node:fs";

const schemaPath = "apps/backend/postprint/realtime/openapi_ws.json";
const outputPath = "tspackages/websocket/src/realtime/realtime.gen.ts";
const schema = JSON.parse(readFileSync(schemaPath, "utf8"));
if (schema.info?.title !== "PostPrint realtime") throw new Error("Unexpected realtime schema");
const generated = `// Generated from the backend AsyncAPI schema. Do not edit by hand.
export type WorkspaceDocumentUpdated = {
\tevent: "workspace.document_updated";
\tdocument_id: string;
\tproject_id: string;
};
`;
writeFileSync(outputPath, generated);
