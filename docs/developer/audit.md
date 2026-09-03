# Audit

<!-- source-of-truth: skeleton audit suites and rule scoping -->

<!-- doc-meta: owner=eng | last-reviewed=2026-09-02 -->

<!-- review-deps: paths=src/cli.ts,src/audit/run.ts -->

When to run which command: [validation](validation.md). Common failures: [troubleshooting](troubleshooting.md). Config keys: [config](config.md).

## Suites

```bash
skeleton audit docs     # links, doc-meta, review-proof, review-deps, ssot, near-duplicate, ssot-summary, prose-policy
skeleton audit skills   # skill-index, multi-root detection, prose-policy (owned skill trees under scan.exclude too; foreign lock skills skipped)
skeleton audit self     # config + all rules (scan corpus; excluded owned skill trees → use audit skills)
```

`review-deps` is an opt-in dependency graph from documents to exact repo-relative paths or globs. `validate changed` uses it for any changed file type; hash review proof invalidates the document when a resolved dependency byte or set changes.

CLI dispatch in `src/cli.ts` covers `audit`, `build-plugin`, `catalog`, `customize`, `hook`, `init`, `register` (removed — errors with migration text), and `validate`. The audit runner exports `runAudit`, `parseAuditArgs`, and `AuditCliOptions` for suites `docs`, `skills`, and `self`.

Autofix (docs only):

```bash
skeleton audit docs --fix                 # anchors + legacy SSOT rewrite
skeleton audit docs --fix=ssot
skeleton audit docs --fix --dry-run
skeleton audit docs --paths=docs/a.md --fix=doc-meta --confirm-reviewed
```

`doc-meta` is not a mechanical fix. It requires explicit paths and `--confirm-reviewed`, updates the authored date to today, and writes hash evidence when `[reviewProof] mode = "hash"` is configured.

## Global vs path-scoped

When `--paths` is set (including `validate changed`), global rules are skipped unless `--base` CI two-pass runs globals first.

| Rule                                                                           | Global |
| ------------------------------------------------------------------------------ | ------ |
| links, doc-meta, review-proof, review-deps, prose-policy (`alwaysRun` — all marked docs) | no* |
| ssot, near-duplicate, ssot-summary, coverage-gaps, scan-roots, skill-index, banned (`deny.paths`) | yes    |

\* `review-deps` is not `global`, but still runs under `--paths` and scans the full perimeter for markers so dependency drift is not skipped when other files change.

## Config

Consumer config is thin: `scan.include`, `scan.exclude`, optional `deny.paths`, optional `scan.nonPublicSkills` (taxonomy exemptions), `daysUntilStale`, optional `docsLint`, optional `reviewProof`, optional `plugins`, optional `draftPathPrefixes`, optional `skillOwnership`. Full reference: [config](config.md). Schema: `schemas/config.schema.json`.

## Machine-readable results

`audit … --json` prints exactly one result object. It reports requested and executed rules, diagnostic codes and remediation, catalog state, and the active review-proof mode/status. Its public contract is `schemas/result.schema.json` plus `@csark0812/skeleton/result-types`. `validate changed` is intentionally plain text only.

Plugins: [plugins.md](plugins.md).

### Skill ownership (consumer vs toolbox)

Lint skill **bodies** where they are authored:

| Repo role             | What to audit                                                                        |
| --------------------- | ------------------------------------------------------------------------------------ |
| Skills / toolbox repo | All (or owned) `SKILL.md` trees via `audit skills`                                   |
| Consumer app repo     | `.skeleton/customize/**`, config/policies; skip foreign synced skill bodies          |

Classification (defaults work with no config):

1. `skillOwnership.ownedSlugs` → owned
2. `skillOwnership.foreignSlugs` → foreign
3. `skills-lock.json` entry with `sourceType` other than `local` (e.g. `github`) → foreign
4. Otherwise → owned

Foreign skills remain discoverable for link resolution and customize inject, but are omitted from docs/self/skills corpora, doc-meta scope, and CI policy skill proves.

### `scan.nonPublicSkills`

Skill slugs that exist on disk but must **not** appear in a nested skills README `## Taxonomy` block (consumer-internal skills). Example: `align-commands`.
