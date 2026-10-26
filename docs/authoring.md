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

After editing a paper, re-read the entire document and attest it only when the content is still correct. Attestation writes the paper's line in `.skeleton/review-lock.toml`; the paper itself carries no review date. Cadence vs changed-since-review: [doc system](developer/doc-system.md#doc-meta).
