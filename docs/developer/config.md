# Config

<!-- source-of-truth: keys and examples -->

<!-- doc-meta: owner=eng | last-reviewed=2026-08-16 -->

<!-- code-fit: targets=src/audit/config/load.ts surface=loadConfig,loadConfigDetailed,findRepoRoot,mergedExcludes -->
<!-- code-fit: targets=src/audit/config/types.ts surface=SkeletonConfig,ScanConfig,DocsLintConfig,DenyConfig,SkillOwnershipConfig,CustomizeConfig -->

Machine schema: [`schemas/config.schema.json`](../../schemas/config.schema.json) (validates the loaded object). Init template: `templates/skeleton-init/skeleton.toml`. Day-one walkthrough: [getting started](getting-started.md).

Loader: `loadConfig` / `loadConfigDetailed` / `findRepoRoot` / `mergedExcludes` in `src/audit/config/load.ts`. Typed shape: `SkeletonConfig` (`ScanConfig`, `DocsLintConfig`, `DenyConfig`, `SkillOwnershipConfig`, `CustomizeConfig`).

Preferred path: **`skeleton.toml` at the repo root**. Legacy `.skeleton/config.yaml` still loads when no TOML is present. If both exist, TOML wins and the CLI warns that YAML is ignored.

## Required

Top-level required keys: `scan` and `daysUntilStale`. Inside `scan`, required: `include`, `exclude`.

| Key              | Purpose                                                                                      |
| ---------------- | -------------------------------------------------------------------------------------------- |
| `scan.include`   | Glob patterns for markdown/docs/skills in the audit perimeter (links, doc-meta, SSOT)        |
| `scan.exclude`   | Removed from the perimeter (drafts, refs, local install trees)                               |
| `daysUntilStale` | Re-read **cadence**: warn (error under `--strict`) when `last-reviewed` is older than N days — not the same as “edited after review” (that uses git; see [doc system](doc-system.md#doc-meta)) |

## Optional

| Key                       | Purpose                                                                                                 |
| ------------------------- | ------------------------------------------------------------------------------------------------------- |
| `deny.paths`              | Repo-wide globs that **must not exist** — audit fails if matched (often outside `include`)              |
| `scan.nonPublicSkills`    | Slugs on disk that must **not** appear in nested skills README `## Taxonomy`                            |
| `plugins`                 | Plugin entry paths relative to `.skeleton/` (each needs a built sibling `.mjs`) — [plugins](plugins.md) |
| `draftPathPrefixes`       | Allow-list prefixes for draft-marker prose policy (plus `_draft-*.md`). Not `scan.exclude`              |
| `customize.alwaysInclude` | Basenames under `.skeleton/customize/` appended on every skill inject — [customize](customize.md)       |
| `skillOwnership`          | Provenance-aware skill body linting (see below)                                                         |
| `docsLint`                | Near-duplicate / SSOT-summary / code-fit thresholds and ignore pairs (see below)            |

Deleted skills need no denylist: links to missing `…/SKILL.md` fail under the links / skill-index rules.

Hard cut: `scan.banned` and `scan.retiredSkills` are rejected by the schema — use `deny.paths` instead of `banned`.

## `deny`

```toml
[deny]
paths = ["apps/**/*_ANALYSIS.md"]
```

## `docsLint`

| Key                      | Purpose                                                              |
| ------------------------ | -------------------------------------------------------------------- |
| `nearDuplicateThreshold` | Jaccard on word shingles (default `0.72`); warn / `--strict` → error |
| `ssotOverlapMin`         | Min fraction of stemmed SSOT tokens in H1/lead/body evidence (default `0.35`) |
| `ssotBetterMatchMargin`  | Sibling must beat own overlap by this much for better-match (default `0.15`) |
| `ssotPhraseCheck`        | When overlap fails, mention missing SSOT phrase in the message (default `true`) |
| `ignorePairs`            | Path pairs skipped by near-dupe / duplicate-SSOT                     |
| `ignoreGlobs`            | Globs skipped by near-dupe / duplicate-SSOT                          |
| `codeFitOverlapMin`      | Min fraction of doc tokens that also appear as code identifiers (default `0.03`) |
| `codeFitSurfaceCap`      | Max auto-extracted names before `surface=` is required (default `25`) |

`ssot-summary` scores stemmed unigrams against H1 + lead + body (SSOT line stripped). Exact phrase match only explains a failed overlap — abstract titles can pass without verbatim phrasing. Better-match warns only when own overlap is weak and another SSOT paper fits better; the message lists rewrite / retarget / consider-combine options.

`code-fit` (surface fit, not behavioral truth): opt-in HTML comment markers with `targets=` (and optional `surface=`). Docs declare code files; audit checks public-name coverage and light identifier overlap. See [doc system](doc-system.md#code-fit-surface-fit).

## `skillOwnership`

When a consumer repo syncs skills from a toolbox (via `skills-lock.json`), Skeleton skips foreign skill **bodies** so linting stays with the owning repo. That skip covers skill-body lint (`audit skills`), path-scoped validate routing, and **doc-meta** for paths under foreign skill trees — including SSOT-bearing `references/**` files. Consumer customizations under `.skeleton/customize/` remain audited here.

| Key            | Purpose                                                                 |
| -------------- | ----------------------------------------------------------------------- |
| `lockfile`     | Repo-relative lock path (default `skills-lock.json`)                    |
| `ownedSlugs`   | Force these slugs owned (lint here) even if the lock marks them foreign |
| `foreignSlugs` | Force these slugs foreign (skip body lint) even if absent from the lock |

Default rules without overrides:

- Lock entry `sourceType: github` (or any non-`local`) → foreign
- Lock entry `sourceType: local`, or slug not in the lock → owned

```toml
[skillOwnership]
lockfile = "skills-lock.json"
# ownedSlugs = ["skeleton"]
# foreignSlugs = ["experimental-local-copy"]
```

See [audit](audit.md#skill-ownership-consumer-vs-toolbox) and [validation](validation.md#skill-body-paths).

## What affects validate vs full audit

| Concern                              | Keys / behavior                                                                                                                           |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Path-scoped `validate changed`       | Files in `scan.include` (minus exclude) get docs audit; owned skill trees route to skills; foreign lock skills skip (body lint + doc-meta); code extensions skip |
| Global rules (`--base` / full audit) | `deny.paths` (rule `banned`), SSOT dual/malformed, near-dupe, ssot-summary, coverage outside include, scan-roots, skill-index, generated-references |
| Prose policies                       | Idle until `plugins` contribute policy YAML                                                                                               |
| Customize inject                     | `customize.alwaysInclude` (optional hooks / `customize resolve`); customize paths are always in the audit corpus                          |
| Skill body ownership                 | `skillOwnership` + `skills-lock.json` (foreign bodies skipped)                                                                            |
| Catalog                              | Local audit warns if `.skeleton/catalog.md` missing/stale; skipped when `CI=true`                                                         |

## Example: toolbox / docs-only

```toml
daysUntilStale = 365

[scan]
include = [
  "docs/**",
  "README.md",
  "AGENTS.md",
]
exclude = ["refs/**"]

[deny]
paths = []
```

## Example: app with plugins

```toml
daysUntilStale = 365

[scan]
include = [
  "docs/**",
  "README.md",
  "AGENTS.md",
  ".claude/skills/**",
]
exclude = [
  "refs/**",
  "**/_draft-*/**",
]

[deny]
paths = ["apps/**/*_ANALYSIS.md"]

plugins = ["plugins/example/example.ts"]
```

Legacy YAML is still accepted when `skeleton.toml` is absent — same keys under `.skeleton/config.yaml`.
