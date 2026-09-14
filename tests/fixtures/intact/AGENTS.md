# Agent entry

<!-- source-of-truth: Intact fixture agent entry -->

<!-- doc-meta: owner=eng | last-reviewed=2099-01-01 -->

Work only in this folder. Use Read only.
First: `skeleton route <path>`. Then run that line.
Reply with the matching token line only.
Docs: `VALIDATE_CMD=skeleton validate changed`
Skill: `SKILL_CMD=skeleton audit skills`
Review-deps: `ATTEST_CMD=skeleton audit docs --paths=<paper> --fix=doc-meta --confirm-reviewed`
Unwired YAML: `ORPHAN=fail-closed`
Foreign skill: `FOREIGN=skip`
Mixed: `MIXED_CMD=skeleton validate changed`
Route: `ROUTE_CMD=skeleton route`
JSON: `JSON_CMD=skeleton validate changed`
Owned TypeScript: `IMPACTED=docs/validation.md`
Unclaimed TypeScript: `UNCOVERED=uncovered-changed-path`
Missing path: `MISSING=missing-path`
Catalog first. Billing reply: `CANONICAL_PATH=` and `WEBHOOK=`.
Do not invent a global audit command.
