# Audit

<!-- source-of-truth: skeleton audit suites and rule scoping -->

<!-- doc-meta: owner=eng -->

<!-- review-deps: paths=src/cli.ts,src/audit/core/**,src/audit/rules/**,src/audit/config/**,src/audit/fix/**,src/audit/policies/**,src/audit/run.ts,src/result-types.ts,src/attest/** -->

When to run which command: [validation](validation.md). Common failures: [troubleshooting](troubleshooting.md). Config keys: [config](config.md).

## Suites

```bash
skeleton audit docs     # links, doc-meta, review-proof, review-deps, review-coverage, ssot, near-duplicate, ssot-summary, prose-policy
skeleton audit skills   # skill-index, multi-root detection, prose-policy (owned skill trees under scan.exclude too; foreign lock skills skipped)
skeleton audit self     # config + all rules (scan corpus; excluded owned skill trees → use audit skills)
```

`review-deps` is an opt-in dependency graph from documents to exact repo-relative paths or globs. `validate changed` uses it for any changed file type; hash review proof invalidates the document when a resolved dependency byte or set changes. A `package.json` dependency ignores its top-level release `version` ([config](config.md#reviewproof)). Local `audit docs` and `audit self` write `.skeleton/catalog.md` on each run. The write is skipped when `CI=true`.

CLI dispatch in `src/cli.ts` covers `attest`, `audit`, `build-plugin`, `catalog`, `context`, `init`, `review`, `route`, and `validate`. `register` and `customize` error with migration text. The audit runner exports `runAudit`, `parseAuditArgs`, and `AuditCliOptions` for suites `docs`, `skills`, and `self`.

Autofix (docs only):

```bash
skeleton audit docs --fix                 # anchors + legacy SSOT rewrite
skeleton audit docs --fix=ssot
skeleton audit docs --fix --dry-run
skeleton attest docs/a.md
skeleton attest --migrate   # move a Skeleton 8 review lock into commit history once; never attests
```

`skeleton attest <doc…>` records a full re-read. It is the same as the older `audit docs --paths=<doc> --fix=doc-meta --confirm-reviewed`, which still works and takes `--reason=<text>`. Attestation adds one empty commit on HEAD (built with `git commit-tree`, so the index, the working tree, and hooks are untouched) whose message carries one `Skeleton-Reviewed: <path> doc=<digest> deps=<digest>|none` line per document. It refuses when the document, a resolved dependency, or an untracked file that a dependency glob matches differs from HEAD: commit first. It fails if the document has no doc-meta comment. When a document's text is unchanged since its last review but its dependencies changed, attestation requires `--reason "<what you checked>"` and records it as a `Skeleton-Review-Note:` line, so a dependency change is not answered with a bare stamp. One call can attest several documents, including documents that depend on each other.

## Global vs path-scoped

When `--paths` is set (including `validate changed`), global rules are skipped unless `--base` CI two-pass runs globals first.

| Rule                                                                           | Global |
| ------------------------------------------------------------------------------ | ------ |
| links, doc-meta, review-proof, prose-policy (path-scoped); review-deps (`alwaysRun`) | no* |
| ssot, near-duplicate, ssot-summary, coverage-gaps, review-coverage, scan-roots, skill-index, banned (`deny.paths`) | yes    |

\* `review-deps` is not `global`, but still runs under `--paths` and scans the full perimeter for markers so dependency drift is not skipped when other files change. `review-proof` reports `review-lock-retired` (a Skeleton 8 lock still present) only on runs without `--paths`, and reports `review-merged-unattested` as a warning there and as an error under `--paths`.

## Config

Consumer config is thin: `scan.include`, `scan.exclude`, optional `deny.paths`, optional `scan.nonPublicSkills` (taxonomy exemptions), `daysUntilStale`, optional `docsLint`, optional `reviewProof`, optional `reviewCoverage`, optional `plugins`, optional `draftPathPrefixes`, optional `skillOwnership`. Full reference: [config](config.md). Schema: `schemas/config.schema.json`.

## Machine-readable results

`audit … --json` prints exactly one result object. It reports requested and executed rules, diagnostic codes and remediation, catalog state, and review-proof status (`not-checked`, `valid`, or `invalid`) with its source (`reviewProof.source`, always `commit-history`). Its public contract is `schemas/result.schema.json` plus `@csark0812/skeleton/result-types`. `validate changed` is intentionally plain text only.

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
