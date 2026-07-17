# Config

**Source of truth for** `.skeleton/config.yaml` keys and examples.

<!-- doc-meta: owner=eng | last-reviewed=2026-07-17 -->

Machine schema: [`schemas/config.schema.json`](../../schemas/config.schema.json). Init template: `templates/skeleton-init/config.yaml`. Day-one walkthrough: [getting started](getting-started.md).

## Required

Top-level required keys: `scan` and `daysUntilStale`. Inside `scan`, required: `include`, `exclude`, `banned`.

| Key              | Purpose                                                                                    |
| ---------------- | ------------------------------------------------------------------------------------------ |
| `scan.include`   | Glob patterns for markdown/docs/skills in the audit perimeter (links, doc-meta, SSOT)      |
| `scan.exclude`   | Removed from the perimeter (drafts, refs, local install trees)                             |
| `scan.banned`    | Repo-wide globs that **must not exist** — audit fails if matched (often outside `include`) |
| `daysUntilStale` | Days before a `last-reviewed` doc-meta date fails in `--strict` mode                       |

## Optional

| Key                       | Purpose                                                                                                 |
| ------------------------- | ------------------------------------------------------------------------------------------------------- |
| `scan.retiredSkills`      | Skill slugs that must not appear as links / index entries                                               |
| `scan.nonPublicSkills`    | Slugs on disk that must **not** appear in nested skills README `## Taxonomy`                            |
| `plugins`                 | Plugin entry paths relative to `.skeleton/` (each needs a built sibling `.mjs`) — [plugins](plugins.md) |
| `draftPathPrefixes`       | Allow-list prefixes for draft-marker prose policy (plus `_draft-*.md`). Not `scan.exclude`              |
| `customize.alwaysInclude` | Basenames under `.skeleton/customize/` appended on every skill inject — [customize](customize.md)       |
| `skillOwnership`          | Provenance-aware skill body linting (see below)                                                         |

## `skillOwnership`

When a consumer repo syncs skills from a toolbox (via `skills-lock.json`), Skeleton skips foreign skill **bodies** so linting stays with the owning repo. That skip covers skill-body lint (`audit skills`), path-scoped validate routing, and **doc-meta** (missing meta, stale `last-reviewed`, git-date freshness) for paths under foreign skill trees — including registry-cited `references/**` files. Consumer customizations under `.skeleton/customize/` remain audited here.

| Key            | Purpose                                                                 |
| -------------- | ----------------------------------------------------------------------- |
| `lockfile`     | Repo-relative lock path (default `skills-lock.json`)                    |
| `ownedSlugs`   | Force these slugs owned (lint here) even if the lock marks them foreign |
| `foreignSlugs` | Force these slugs foreign (skip body lint) even if absent from the lock |

Default rules without overrides:

- Lock entry `sourceType: github` (or any non-`local`) → foreign
- Lock entry `sourceType: local`, or slug not in the lock → owned

```yaml
skillOwnership:
  lockfile: skills-lock.json
  # ownedSlugs: [skeleton]
  # foreignSlugs: [experimental-local-copy]
```

See [audit](audit.md#skill-ownership-consumer-vs-toolbox) and [validation](validation.md#skill-body-paths).

## What affects validate vs full audit

| Concern                              | Keys / behavior                                                                                                                           |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Path-scoped `validate changed`       | Files in `scan.include` (minus exclude) get docs audit; owned skill trees route to skills; foreign lock skills skip (body lint + doc-meta); code extensions skip |
| Global rules (`--base` / full audit) | `scan.banned`, registry, coverage outside include, scan-roots, skill-index                                                                |
| Prose policies                       | Idle until `plugins` contribute policy YAML                                                                                               |
| Customize inject                     | `customize.alwaysInclude` (hooks / `customize resolve`); customize paths are always in the audit corpus                                   |
| Skill body ownership                 | `skillOwnership` + `skills-lock.json` (foreign bodies skipped)                                                                            |

## Example: toolbox / docs-only

```yaml
# yaml-language-server: $schema=node_modules/@csark0812/skeleton/schemas/config.schema.json

scan:
  include:
    - "docs/**"
    - "README.md"
    - ".skeleton/registry.md"
    - "AGENTS.md"
  exclude:
    - "refs/**"
  banned: []
  retiredSkills: []

daysUntilStale: 180
```

## Example: app with plugins

```yaml
# yaml-language-server: $schema=node_modules/@csark0812/skeleton/schemas/config.schema.json

scan:
  include:
    - "docs/**"
    - "README.md"
    - "AGENTS.md"
    - ".skeleton/registry.md"
    - ".claude/skills/**"
  exclude:
    - "refs/**"
    - "**/_draft-*/**"
  banned:
    - "apps/**/*_ANALYSIS.md"
  retiredSkills: []
  nonPublicSkills:
    - "align-commands"

daysUntilStale: 180

customize:
  alwaysInclude:
    - shared-agent-references.md

plugins:
  - plugins/example/example.ts

draftPathPrefixes:
  - drafts/
```

After adding plugins: run `skeleton build-plugin` and commit the sibling `.mjs` (+ stamp). CI: `skeleton build-plugin --check`.

## Related

- [Getting started](getting-started.md)
- [Audit](audit.md) — rule scoping
- [Plugins](plugins.md)
- [Customize](customize.md)
- [Validation](validation.md)
