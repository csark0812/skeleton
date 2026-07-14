# Audit

**Source of truth for** skeleton audit suites and rule scoping.

<!-- doc-meta: owner=eng | last-reviewed=2026-07-13 -->

## Suites

```bash
skeleton audit docs     # links, doc-meta, registry (when full pass), prose-policy (when plugins supply policies)
skeleton audit skills   # skill-index, multi-root detection
skeleton audit self     # config + all rules
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

Consumer config is thin: `scan.include`, `scan.exclude`, `scan.banned`, optional `scan.retiredSkills`, optional `scan.nonPublicSkills` (taxonomy exemptions), `daysUntilStale`, optional `plugins`, optional `draftPathPrefixes`. See `schemas/config.schema.json`.

Plugins: [plugins.md](plugins.md).

### `scan.nonPublicSkills`

Skill slugs that exist on disk but must **not** appear in a nested skills README `## Taxonomy` block (consumer-internal skills). Example: `align-commands`.
