# Authoring conventions

<!-- source-of-truth: Skeleton framework authoring conventions -->

<!-- doc-meta: owner=eng -->

<!-- review-deps: paths=src/catalog.ts -->

Every canonical doc in a skeleton-enabled repo carries a `source-of-truth` marker (comment or visible line). Opt in that way — no hand-maintained registry. Local audit and `validate changed` write the agent index (`refreshLocalCatalog` / `writeCatalog`). `skeleton catalog` still refreshes it on demand.

Full day-one flow: [getting started](developer/getting-started.md). Banner / catalog / doc-meta detail: [doc system](developer/doc-system.md).

## Doc meta

Index docs and SSOT-bearing files require a doc-meta comment:

```markdown
<!-- doc-meta: owner=eng -->
```

When a change touches a file a paper declares in `review-deps`, re-read the entire paper and update it in the same commit if it is out of date; pre-commit warns, but does not block, when the paper is unchanged. Nothing records reviews and the paper carries no review date. Details: [keeping documents current](developer/doc-system.md#keeping-documents-current).
