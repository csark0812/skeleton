# Doc system

**Source of truth for** skeleton doc and catalog conventions.

<!-- doc-meta: owner=eng | last-reviewed=2026-08-16 -->

Day-one walkthrough: [getting started](getting-started.md). Short authoring summary: [authoring](../authoring.md).

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

## Doc meta

Index docs and SSOT-bearing files require:

```markdown
<!-- doc-meta: owner=eng | last-reviewed=2026-07-14 -->
```

SSOT paths under **foreign** (lockfile-synced) skill trees are excluded from doc-meta in consumer repos — keep `last-reviewed` cadence in the owning toolbox repo. See [config](config.md#skillownership).

## Example canonical doc

```markdown
# API conventions

<!-- source-of-truth: Backend API conventions -->

<!-- doc-meta: owner=eng | last-reviewed=2026-07-14 -->

Keep request and response shapes consistent across services.
```

Then:

```bash
skeleton catalog
skeleton audit docs
```
