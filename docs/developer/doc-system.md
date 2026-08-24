# Doc system

<!-- source-of-truth: skeleton doc and catalog conventions -->

<!-- doc-meta: owner=eng | last-reviewed=2026-08-24 -->

<!-- review-deps: paths=src/catalog.ts,src/audit/core/ssot-fit.ts,src/audit/rules/doc-meta.ts -->

Day-one walkthrough: [getting started](getting-started.md). Short authoring summary: [authoring](../authoring.md).

Catalog CLI: `runCatalogCli`, `checkCatalog`, `writeCatalog`, `buildCatalogContent`, `catalogAuditWarnings`. Summary fit: `evaluateSsotFit` / `ssotEvidenceOverlap` / `buildEvidenceText`. Doc-meta rule: `runDocMetaRule` (`docMetaRule`).

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

`.skeleton/catalog.md` is **generated and gitignored**. Agents should run `skeleton catalog` if it is missing, then skim summaries before opening full papers.

```bash
skeleton catalog
skeleton catalog --check   # warn if missing/outdated (local)
skeleton catalog --check --strict  # fail if missing/outdated
```

Local `audit docs` warns when the catalog is missing/stale; the check is skipped when `CI=true`.

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

## Doc meta

Index docs and SSOT-bearing files require:

```markdown
<!-- doc-meta: owner=eng | last-reviewed=2026-08-16 -->
```

`last-reviewed` is the **only** authored freshness date — a human claim that someone stood behind this text as of that day. Do **not** add a parallel `last-edited` field; git is the last-edit signal.

Audit treats review invalidation and calendar cadence differently:

| Signal | Meaning | Typical fix |
| ------ | ------- | ----------- |
| Content changed after `last-reviewed` (git or hash proof) | Blocking error: review no longer covers the latest edit or linked dependency bytes | **Required:** re-read the entire document against current dependencies, then attest it. Do not change the date alone. |
| `last-reviewed` older than `daysUntilStale` | Optional **re-read cadence** for untouched papers — process hygiene, not “the text drifted” | Re-affirm or bump after review; warn-only unless `--strict` |

SSOT paths under **foreign** (lockfile-synced) skill trees are excluded from doc-meta in consumer repos — keep review cadence in the owning toolbox repo. See [config](config.md#skillownership).

### Explicit review attestation

```bash
skeleton audit docs --paths=docs/api.md --fix=doc-meta --confirm-reviewed
```

The command requires explicit paths. It sets `last-reviewed` to today only after the operator confirms a complete review. With `[reviewProof] mode = "hash"`, it also writes `.skeleton/review-lock.json` with deterministic document and dependency hashes. Bare `--fix` never touches review dates.

## Example canonical doc

```markdown
# API conventions

<!-- source-of-truth: Backend API conventions -->

<!-- doc-meta: owner=eng | last-reviewed=2026-08-16 -->

Keep request and response shapes consistent across services.
```

Then:

```bash
skeleton catalog
skeleton audit docs
```
