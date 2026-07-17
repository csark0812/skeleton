# Audit

**Source of truth for** skeleton audit suites and rule scoping.

<!-- doc-meta: owner=eng | last-reviewed=2026-07-17 -->

When to run which command: [validation](validation.md). Common failures: [troubleshooting](troubleshooting.md). Config keys: [config](config.md).

## Suites

```bash
skeleton audit docs     # links, doc-meta, registry (when full pass), prose-policy (when plugins supply policies)
skeleton audit skills   # skill-index, multi-root detection, prose-policy (owned skill trees under scan.exclude too; foreign lock skills skipped)
skeleton audit self     # config + all rules (scan corpus; excluded owned skill trees → use audit skills)
```

Autofix (docs only):

```bash
skeleton audit docs --fix                 # doc-meta + anchors
skeleton audit docs --fix=doc-meta
skeleton audit docs --fix --dry-run
```

## Global vs path-scoped

When `--paths` is set (including `validate changed`), global rules are skipped unless `--base` CI two-pass runs globals first.

| Rule                                                                           | Global |
| ------------------------------------------------------------------------------ | ------ |
| links, doc-meta, prose-policy                                                  | no     |
| registry, banned, coverage-gaps, scan-roots, skill-index, generated-references | yes    |

## Config

Consumer config is thin: `scan.include`, `scan.exclude`, `scan.banned`, optional `scan.retiredSkills`, optional `scan.nonPublicSkills` (taxonomy exemptions), `daysUntilStale`, optional `plugins`, optional `draftPathPrefixes`, optional `skillOwnership`. Full reference: [config](config.md). Schema: `schemas/config.schema.json`.

Plugins: [plugins.md](plugins.md).

### Skill ownership (consumer vs toolbox)

Lint skill **bodies** where they are authored:

| Repo role             | What to audit                                                                        |
| --------------------- | ------------------------------------------------------------------------------------ |
| Skills / toolbox repo | All (or owned) `SKILL.md` trees via `audit skills`                                   |
| Consumer app repo     | `.skeleton/customize/**`, config/registry/policies; skip foreign synced skill bodies |

Classification (defaults work with no config):

1. `skillOwnership.ownedSlugs` → owned
2. `skillOwnership.foreignSlugs` → foreign
3. `skills-lock.json` entry with `sourceType` other than `local` (e.g. `github`) → foreign
4. Otherwise → owned

Foreign skills remain discoverable for link resolution and customize inject, but are omitted from docs/self/skills corpora, doc-meta scope, and CI policy skill proves.

### `scan.nonPublicSkills`

Skill slugs that exist on disk but must **not** appear in a nested skills README `## Taxonomy` block (consumer-internal skills). Example: `align-commands`.
