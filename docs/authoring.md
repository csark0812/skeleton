# Authoring conventions

<!-- source-of-truth: Skeleton framework authoring conventions -->

<!-- doc-meta: owner=eng | last-reviewed=2026-08-16 -->

Every canonical doc in a skeleton-enabled repo carries a `source-of-truth` marker (comment or visible line). Opt in that way — no hand-maintained registry. Refresh the agent index with `skeleton catalog`.

Full day-one flow: [getting started](developer/getting-started.md). Banner / catalog / doc-meta detail: [doc system](developer/doc-system.md).

## Doc meta

Index docs and SSOT-bearing files require a doc-meta comment:

```markdown
<!-- doc-meta: owner=eng | last-reviewed=2026-08-16 -->
```

Bump `last-reviewed` after a real re-read when you edit the paper (git is last-edit; there is no separate authored edit date). Cadence vs edit-behind-review: [doc system](developer/doc-system.md#doc-meta).
