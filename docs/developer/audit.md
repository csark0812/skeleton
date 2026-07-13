# Audit

**Source of truth for** skeleton audit suites and rule scoping.

<!-- doc-meta: owner=eng | last-reviewed=2026-07-13 -->

## Suites

```bash
skeleton audit docs     # links, doc-meta, registry (when full pass)
skeleton audit skills   # skill-index, multi-root detection
skeleton audit self     # config + all rules
```

## Global vs path-scoped

When `--paths` is set (including `validate changed`), global rules are skipped unless `--base` CI two-pass runs globals first.

| Rule | Global |
|------|--------|
| links, doc-meta | no |
| registry, banned, coverage-gaps, scan-roots, skill-index, generated-references | yes |

## Config

Consumer config is thin: `scan.include`, `scan.exclude`, `scan.banned`, optional `scan.retiredSkills`, optional `scan.nonPublicSkills` (taxonomy exemptions), `daysUntilStale`. See `schemas/config.schema.json`.

### `scan.nonPublicSkills`

Skill slugs that exist on disk but must **not** appear in a nested skills README `## Taxonomy` block (consumer-internal skills). Example: `align-commands`.
