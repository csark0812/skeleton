# Doc system

<!-- source-of-truth: skeleton doc and catalog conventions -->

<!-- doc-meta: owner=eng | last-reviewed=2026-08-19 -->

<!-- code-fit: targets=src/catalog.ts surface=runCatalogCli,checkCatalog,writeCatalog,buildCatalogContent,catalogAuditWarnings -->
<!-- code-fit: targets=src/audit/core/ssot-fit.ts surface=evaluateSsotFit,ssotEvidenceOverlap,buildEvidenceText -->
<!-- code-fit: targets=src/audit/rules/doc-meta.ts surface=runDocMetaRule,docMetaRule -->

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
```

Local `audit docs` warns when the catalog is missing/stale; the check is skipped when `CI=true`.

## SSOT summary fit (`ssot-summary`)

Audit checks that each opt-in one-liner still matches its paper (warn / `--strict`):

- Stemmed token overlap against **H1 + first lead paragraph + body** (SSOT/meta/code stripped)
- If overlap fails, the message may note a missing key phrase (not a second gate when overlap already passes)
- If own overlap is weak and another SSOT file fits better, warn with fix options (rewrite / retarget / consider combine)
- Too-short summaries and duplicate SSOT lines (via `near-duplicate`) stay high-signal guards

This keeps the agent catalog honest after renames, splits, and copy-paste — without an LLM.

## Code-fit (surface fit)

Opt-in markers stake that a doc covers named code files:

```markdown
<!-- code-fit: targets=src/cli.ts,src/audit/run.ts -->
<!-- code-fit: targets=src/big.ts surface=runAudit,parseAuditArgs -->
```

`audit docs` then checks (errors on failure):

- Target paths exist
- Public surface names (exports + `case "…"` labels) appear in the doc body — or the explicit `surface=` list (required when auto-extract exceeds `docsLint.codeFitSurfaceCap`, default 25)
- Identifier overlap (doc tokens grounded in the module). When extractable surface is **empty**, coverage is skipped and only lexical overlap applies

Unmarked prose is ignored. Marked docs are always re-checked when the docs suite runs (including under `--paths`). This is **surface fit**, not a docs↔code truth checker.

## Doc meta

Index docs and SSOT-bearing files require:

```markdown
<!-- doc-meta: owner=eng | last-reviewed=2026-08-16 -->
```

`last-reviewed` is the **only** authored freshness date — a human claim that someone stood behind this text as of that day. Do **not** add a parallel `last-edited` field; git is the last-edit signal.

Audit treats two different warnings:

| Signal | Meaning | Typical fix |
| ------ | ------- | ----------- |
| Content changed after `last-reviewed` (git) | Review no longer covers the latest edit — the high-precision “accurately stale” gate | **Required:** re-read the entire document, then bump `last-reviewed` only if the content is still correct. Do not change the date alone. |
| `last-reviewed` older than `daysUntilStale` | Optional **re-read cadence** for untouched papers — process hygiene, not “the text drifted” | Re-affirm or bump after review; warn-only unless `--strict` |

SSOT paths under **foreign** (lockfile-synced) skill trees are excluded from doc-meta in consumer repos — keep review cadence in the owning toolbox repo. See [config](config.md#skillownership).

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
