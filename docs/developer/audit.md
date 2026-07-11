# Audit

**Source of truth for** skeleton audit suites and rule scoping.

<!-- doc-meta: owner=eng | last-reviewed=2026-07-11 -->

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
| registry, banned, coverage-gaps, scan-roots, skill-index | yes |

## Config

Consumer config is thin: `scan.include`, `scan.exclude`, `scan.banned`, optional `scan.retiredSkills`, `daysUntilStale`. See `schemas/config.schema.json`.
