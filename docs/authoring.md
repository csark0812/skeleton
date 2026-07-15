**Source of truth for** Skeleton framework authoring conventions.

<!-- doc-meta: owner=eng | last-reviewed=2026-07-14 -->

Every canonical doc in a skeleton-enabled repo carries a `**Source of truth for** …` banner and is listed in `.skeleton/registry.md`.

Full day-one flow: [getting started](developer/getting-started.md). Banner / registry / doc-meta detail: [doc system](developer/doc-system.md).

## Doc meta

Index docs and registry-listed files require a doc-meta comment:

```markdown
<!-- doc-meta: owner=eng | last-reviewed=2026-07-14 -->
```

## Registry

Run `skeleton register <path>` after writing a canonical file — do not hand-edit the table unless register fails.
