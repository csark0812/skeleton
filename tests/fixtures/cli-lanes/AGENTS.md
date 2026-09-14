# Agent entry

<!-- source-of-truth: cli-lanes fixture agent entry -->

<!-- doc-meta: owner=eng | last-reviewed=2099-01-01 -->

Work only in this folder. Use Read only.
Do not run Shell. Do not write files.
Read this file first. Then read `.skeleton/catalog.md`.
Match the human ask to the first column.
Copy the token line after the colon. Keep `<paper>` and `--fix`.

markdown file under docs: VALIDATE_CMD=skeleton validate changed
owned-demo/SKILL.md: SKILL_CMD=skeleton audit skills
review-deps already re-read: ATTEST_CMD=skeleton audit docs --paths=<paper> --fix=doc-meta --confirm-reviewed
docs and TypeScript in one commit: MIXED_CMD=skeleton validate changed
YAML under .skeleton that no plugin lists: ORPHAN=fail-closed
classify one changed path: ROUTE_CMD=skeleton route
TypeScript under src: IMPACTED=docs/validation.md
TypeScript that no document claims: UNCOVERED=uncovered-changed-path
JSON under data: JSON_CMD=skeleton validate changed
skill imported from GitHub: FOREIGN=skip
docs path not on disk: MISSING=missing-path
canonical Billing API webhook: CANONICAL_PATH=docs/billing-api.md WEBHOOK=https://api.example.com/v2/billing/webhook

Do not invent a global audit command.
