# Doc system

<!-- source-of-truth: skeleton doc and catalog conventions -->

<!-- doc-meta: owner=eng -->

<!-- review-deps: paths=src/catalog.ts,src/audit/core/ssot-fit.ts,src/audit/rules/doc-meta.ts,src/audit/rules/review-deps.ts,src/audit/core/review-deps.ts,src/audit/core/review-digest.ts,src/audit/core/review-proof.ts,src/audit/core/review-proof-file.ts -->

Day-one walkthrough: [getting started](getting-started.md). Short authoring summary: [authoring](../authoring.md).

Catalog CLI: `runCatalogCli`, `checkCatalog`, `writeCatalog`, `buildCatalogContent`, `refreshLocalCatalog`. Summary fit: `evaluateSsotFit` / `ssotEvidenceOverlap` / `buildEvidenceText`. Doc-meta rule: `runDocMetaRule` (`docMetaRule`).

## Source of truth (opt-in)

Canonical docs carry one SSOT marker (comment **or** visible — not both):

```markdown
<!-- source-of-truth: Topic name -->
```

or:

```markdown
source-of-truth: Topic name
```

Legacy `**Source of truth for** Topic name.` is still accepted; `skeleton audit docs --fix=ssot` rewrites it to the comment form.

Files without an SSOT marker are fine — they are simply not listed in the agent catalog.

## Catalog

`.skeleton/catalog.md` is **generated and gitignored**. The file is a short summary table. Local `audit docs`, `audit self`, and `validate changed` write it on each run. The write is skipped when `CI=true`.

To classify one path without an audit, run `skeleton route <path>`. Bare `skeleton route` prints the lane card.

```bash
skeleton catalog
skeleton catalog --check   # warn if missing/outdated (local)
skeleton catalog --check --strict  # fail if missing/outdated
```

Use `skeleton catalog` when you want a refresh without an audit.

## SSOT summary fit (`ssot-summary`)

Audit checks that each opt-in one-liner still matches its paper (warn / `--strict`):

- Stemmed token overlap against **H1 + first lead paragraph + body** (SSOT/meta/code stripped)
- If overlap fails, the message may note a missing key phrase (not a second gate when overlap already passes)
- If own overlap is weak and another SSOT file fits better, warn with fix options (rewrite / retarget / consider combine)
- Too-short summaries and duplicate SSOT lines (via `near-duplicate`) stay high-signal guards

This keeps the agent catalog honest after renames, splits, and copy-paste — without an LLM.

## Review dependencies

Opt-in markers declare the repository state a doc depends on:

```markdown
<!-- review-deps: paths=src/cli.ts,src/audit/run.ts -->
```

Each comma-separated path is repo-relative. Exact paths must exist; globs may temporarily match no files and emit a warning (an error under `--strict`). Marked docs are always re-checked when the docs suite runs, including under `--paths`. `validate changed` treats every dependency as an edge and adds linked docs when a matching file changes. Hash review proof supplies the exact invalidation signal.

A dependency may name one key path in one `.json` file, for example `package.json#scripts` or `config/app.json#server.port`. Only the selected values are compared, as key-sorted JSON, and a missing key counts as evidence. Selectors are not allowed on globs. Any change to the file still pulls the document into `validate changed`. Markdown dependencies are compared without their doc-meta comment.

Keep dependencies narrow. The `review-deps` rule warns `review-dependency-broad` when a document depends on a whole `package.json` (every dependency bump would ask for a re-read; name the keys it describes instead) and `review-dependency-cycle` when documents depend on each other (editing one asks for a re-read of the other; link them instead).

## Doc meta

Index docs and SSOT-bearing files require:

```markdown
<!-- doc-meta: owner=eng -->
```

The comment names an owner only. Review evidence lives outside the document, as the document's line in `.skeleton/review-lock.toml`. Do **not** add review or edit dates: git dates that line, and its hashes say exactly what was reviewed. A legacy `| last-reviewed=<date>` suffix is still parsed, warns `legacy-review-date`, and is removed by `skeleton attest --repair` or by the next attestation.

Audit treats review invalidation and calendar cadence differently:

| Signal | Meaning | Typical fix |
| ------ | ------- | ----------- |
| Document or dependency bytes differ from the proof (`review-document-changed`, `review-dependency-changed`) | Blocking error: the review no longer covers the latest edit or linked dependency bytes | **Required:** re-read the entire document against current dependencies, then attest it. |
| Commit that last changed the document's proof line older than `daysUntilStale` (`review-cadence-exceeded`) | Optional **re-read cadence** for untouched papers — process hygiene, not “the text drifted” | Re-read, then attest again; warn-only unless `--strict` |

SSOT paths under **foreign** (lockfile-synced) skill trees are excluded from doc-meta in consumer repos — keep review cadence in the owning toolbox repo. See [config](config.md#skillownership).

### Explicit review attestation

```bash
skeleton attest docs/api.md
```

The command names the documents you re-read in full; it is the explicit claim that you did. It writes the document's line in `.skeleton/review-lock.toml` with deterministic document and dependency hashes, leaves other entries unchanged, and leaves the document unchanged (apart from removing a legacy date). Bare `--fix` never attests.

## Example canonical doc

```markdown
# API conventions

<!-- source-of-truth: Backend API conventions -->

<!-- doc-meta: owner=eng -->

Keep request and response shapes consistent across services.
```

Then:

```bash
skeleton catalog
skeleton audit docs
```
