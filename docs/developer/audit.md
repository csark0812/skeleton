# Audit

<!-- source-of-truth: skeleton audit suites and rule scoping -->

<!-- doc-meta: owner=eng -->

<!-- review-deps: paths=src/cli.ts,src/audit/core/**,src/audit/rules/**,src/audit/config/**,src/audit/fix/**,src/audit/policies/**,src/audit/run.ts,src/result-types.ts -->

When to run which command: [validation](validation.md). Common failures: [troubleshooting](troubleshooting.md). Config keys: [config](config.md).

## Suites

```bash
skeleton audit docs     # links, package-references, doc-meta, review-deps, review-coverage, ssot, near-duplicate, ssot-summary, prose-policy
skeleton audit skills   # skill-index, multi-root detection, prose-policy (owned skill trees under scan.exclude too; foreign lock skills skipped)
skeleton audit self     # config + all rules (scan corpus; excluded owned skill trees → use audit skills)
```

`review-deps` is an opt-in dependency graph from documents to exact repo-relative paths or globs. `validate changed` uses it for any changed file type and reports a document whose dependency changed while it did not ([doc system](doc-system.md#keeping-documents-current)). Local `audit docs` and `audit self` write `.skeleton/catalog.md` on each run. The write is skipped when `CI=true`.

## References

A document's reference to another file must still resolve. The part after `#` is read by the target's type, in links and in `review-deps` alike:

| Target | Selector | Example |
| ------ | -------- | ------- |
| `.json` | dotted key path | `[test](../package.json#scripts.test)` |
| `.md`, `.mdx` | heading slug | `[install](getting-started.md#install)` |
| any other file | symbol, whole word; `Class.member` for members | `[parseAuditArgs](../../src/audit/run.ts#parseAuditArgs)` |
| any other file | line range, links only | `[cli](../../src/cli.ts#L15-L30)` |

`links` reports a selector that names nothing as `broken anchor`; `--fix` repairs near-miss heading slugs only. A bare name with no file (`` `parseAuditArgs` ``) is not checked: name the file in a link.

`package-references` treats a package-manager command in inline code or a shell fence as a reference to `package.json#scripts.<name>`. The manager comes from `packageManager` in the nearest `package.json`; the manager's own commands (`pnpm install`, `bun test`), file paths, placeholders, and workspace flags (`--filter`, `-C`, `-r`) are skipped. Codes:

- `unknown-script`: any scanned document runs a script that package.json does not define.
- `missing-toolchain-fact`: the `AGENTS.md` beside a package.json does not quote its exact `packageManager` or `engines.node` value in backticks.

`validate changed` audits documents the diff never touched when a change can break one of their references: a link to a changed file, or a command whose package.json changed.

CLI dispatch in `src/cli.ts` covers `audit`, `build-plugin`, `catalog`, `context`, `init`, `review`, `route`, and `validate`. `register` and `customize` error with migration text. The audit runner exports `runAudit`, `parseAuditArgs`, and `AuditCliOptions` for suites `docs`, `skills`, and `self`.

Autofix (docs only):

```bash
skeleton audit docs --fix                 # anchors + legacy SSOT rewrite
skeleton audit docs --fix=ssot
skeleton audit docs --fix --dry-run
```

## Global vs path-scoped

When `--paths` is set (including `validate changed`), global rules are skipped unless `--base` CI two-pass runs globals first.

| Rule                                                                           | Global |
| ------------------------------------------------------------------------------ | ------ |
| links, package-references, doc-meta, prose-policy (path-scoped); review-deps (`alwaysRun`) | no* |
| ssot, near-duplicate, ssot-summary, coverage-gaps, review-coverage, scan-roots, skill-index, banned (`deny.paths`) | yes    |

\* `review-deps` is not `global`, but still runs under `--paths` and scans the full perimeter for markers so dependency drift is not skipped when other files change.

## Config

Consumer config is thin: `scan.include`, `scan.exclude`, optional `deny.paths`, optional `scan.nonPublicSkills` (taxonomy exemptions), `daysUntilStale`, optional `docsLint`, optional `reviewCoverage`, optional `plugins`, optional `draftPathPrefixes`, optional `skillOwnership`. Full reference: [config](config.md). Schema: `schemas/config.schema.json`.

## Machine-readable results

`audit … --json` prints exactly one result object. It reports requested and executed rules, diagnostic codes and remediation, and catalog state. Its public contract is `schemas/result.schema.json` plus `@csark0812/skeleton/result-types`. `validate changed` is intentionally plain text only.

Plugins: [plugins.md](plugins.md).

### Skill ownership (consumer vs toolbox)

Lint skill **bodies** where they are authored:

| Repo role             | What to audit                                                                        |
| --------------------- | ------------------------------------------------------------------------------------ |
| Skills / toolbox repo | All (or owned) `SKILL.md` trees via `audit skills`                                   |
| Consumer app repo     | config/policies; skip foreign synced skill bodies                                    |

Classification (defaults work with no config):

1. `skillOwnership.ownedSlugs` → owned
2. `skillOwnership.foreignSlugs` → foreign
3. `skills-lock.json` entry with `sourceType` other than `local` (e.g. `github`) → foreign
4. Otherwise → owned

Foreign skills remain discoverable for link resolution, but are omitted from docs/self/skills corpora, doc-meta scope, and CI policy skill proves.

### `scan.nonPublicSkills`

Skill slugs that exist on disk but must **not** appear in a nested skills README `## Taxonomy` block (consumer-internal skills). Example: `align-commands`.
