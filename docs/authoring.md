# Authoring conventions

<!-- source-of-truth: Skeleton framework authoring conventions -->

<!-- doc-meta: owner=eng | last-reviewed=2026-08-19 -->

<!-- code-fit: targets=src/catalog.ts surface=runCatalogCli,checkCatalog,writeCatalog -->

Every canonical doc in a skeleton-enabled repo carries a `source-of-truth` marker (comment or visible line). Opt in that way — no hand-maintained registry. Refresh the agent index with `skeleton catalog` (`runCatalogCli` / `checkCatalog` / `writeCatalog`).

Full day-one flow: [getting started](developer/getting-started.md). Banner / catalog / doc-meta detail: [doc system](developer/doc-system.md).

## Doc meta

Index docs and SSOT-bearing files require a doc-meta comment:

```markdown
<!-- doc-meta: owner=eng | last-reviewed=2026-08-16 -->
```

After editing a paper, re-read the entire document and bump `last-reviewed` only when the content is still correct. Do not change the date alone: git is the last-edit signal, and there is no separate authored edit date. Cadence vs edit-behind-review: [doc system](developer/doc-system.md#doc-meta).
