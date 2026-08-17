# Audit

<!-- source-of-truth: skeleton audit suites and rule scoping -->

<!-- doc-meta: owner=eng | last-reviewed=2026-08-16 -->

<!-- code-fit: targets=src/cli.ts surface=audit,build-plugin,catalog,customize,hook,init,references,register,validate -->
<!-- code-fit: targets=src/audit/run.ts surface=runAudit,parseAuditArgs,AuditCliOptions,docs,skills,self -->

When to run which command: [validation](validation.md). Common failures: [troubleshooting](troubleshooting.md). Config keys: [config](config.md).

## Suites

```bash
skeleton audit docs     # links, doc-meta, ssot, near-duplicate, ssot-summary, prose-policy (when plugins supply policies), code-fit (when markers present)
skeleton audit skills   # skill-index, multi-root detection, prose-policy (owned skill trees under scan.exclude too; foreign lock skills skipped)
skeleton audit self     # config + all rules (scan corpus; excluded owned skill trees → use audit skills)
```

`code-fit` is **surface fit** (opt-in markers → target code files): public-name coverage plus light identifier overlap. It is not a behavioral docs↔code truth checker. Marked docs are re-checked whenever the docs suite runs, even under `--paths`.

CLI dispatch in `src/cli.ts` covers `audit`, `build-plugin`, `catalog`, `customize`, `hook`, `init`, `references`, `register` (removed — errors with migration text), and `validate`. The audit runner exports `runAudit`, `parseAuditArgs`, and `AuditCliOptions` for suites `docs`, `skills`, and `self`.

Autofix (docs only):

```bash
skeleton audit docs --fix                 # doc-meta + anchors + legacy SSOT rewrite
skeleton audit docs --fix=doc-meta
skeleton audit docs --fix=ssot
skeleton audit docs --fix --dry-run
```

## Global vs path-scoped

When `--paths` is set (including `validate changed`), global rules are skipped unless `--base` CI two-pass runs globals first.

| Rule                                                                           | Global |
| ------------------------------------------------------------------------------ | ------ |
| links, doc-meta, prose-policy, code-fit (`alwaysRun` — all marked docs)          | no*    |
| ssot, near-duplicate, ssot-summary, coverage-gaps, scan-roots, skill-index, generated-references, banned (`deny.paths`) | yes    |

\* `code-fit` is not `global`, but still runs under `--paths` and scans the full perimeter for markers so code drift is not skipped when only other files change.

## Config

Consumer config is thin: `scan.include`, `scan.exclude`, optional `deny.paths`, optional `scan.nonPublicSkills` (taxonomy exemptions), `daysUntilStale`, optional `docsLint`, optional `plugins`, optional `draftPathPrefixes`, optional `skillOwnership`. Full reference: [config](config.md). Schema: `schemas/config.schema.json`.

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
