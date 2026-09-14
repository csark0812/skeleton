# Troubleshooting

<!-- source-of-truth: common Skeleton validation failures -->

<!-- doc-meta: owner=eng | last-reviewed=2026-09-13 -->

<!-- review-deps: paths=src/validate/**,src/audit/run.ts -->

Failures usually come from `runValidateChanged` / `codeValidationHint` or `runAudit` / `parseAuditArgs`.

To learn the lane without an audit, run `skeleton route` or `skeleton route <path>`.

Decision table and routing: [validation](validation.md). Day-one setup: [getting started](getting-started.md).

## `uncovered-changed-path`

**Cause:** A live coverage-candidate file changed and no scanned paper lists it in `review-deps`. Deleted files do not fire this code.

**Fix:** Add a `review-deps` path or glob on the owning paper. Then re-read that paper and attest it.

The same error fires on local, `--staged`, and `--base` runs. A mixed docs commit does not hide it.

## `stage-required`

**Cause:** `--staged` saw an impacted paper or hash lockfile that differs from HEAD and is not in the index.

**Fix:** Stage the attested document. In hash mode, stage `.skeleton/review-lock.json` too.

## `validate changed: all paths were skipped`

**Cause:** Every input was outside the docs, skills, policy, and coverage-candidate set.

**Fix:** Pass docs or skill paths if you intended SSOT validation. Run your repo code gates for application tests.

## Owned skill-only paths

**Cause:** Changes under an owned skill tree need the skills suite.

`validate changed` runs that suite. You can also run:

```bash
skeleton audit skills
```

Foreign / lockfile-synced skill bodies are skipped with a log message because
their owning skills or toolbox repo is responsible for linting them. Ownership
comes from `skills-lock.json` and optional `skillOwnership` overrides; see
[config](config.md#skillownership).

## Plugin policy YAML

**Cause:** You changed YAML matched by a plugin `policies` glob.

`validate changed` schema-checks the file, then runs full docs and owned-skill prose. `audit self` alone does not cover excluded skill trees.

## Orphan `.skeleton/**/*.yaml`

**Cause:** A YAML file under `.skeleton/` is not `config.yaml` and is not matched by any plugin `policies` glob.

**Fix:** Export a `policies` glob from a plugin that includes the file ([plugins](plugins.md)), or remove/move the file so it is not under `.skeleton/`.

## Missing path / no paths on disk

**Cause:** Explicit paths do not exist, or git diff resolved to nothing usable.

**Fix:** Pass real paths, or use:

```bash
skeleton validate changed --staged
skeleton validate changed --base origin/main
```

## Plugin `.mjs` missing or stale

**Cause:** Runtime loads only the sibling `.mjs`; authors must commit source **and** build artifact.

**Fix:**

```bash
skeleton build-plugin
skeleton build-plugin --check   # CI: fail if missing, unstamped, or content-stale
```

Requires Bun on `PATH` for `build-plugin` (not for `--check`). See [plugins](plugins.md).

## Doc-meta and review-proof failures

Two different signals (see [doc system](doc-system.md#doc-meta)):

**Review behind latest edit** — message mentions `content changed after last-reviewed` / a git date.

**Cause:** The file’s last content commit is newer than `last-reviewed`, so the stamp no longer covers the paper.

**Fix:** Re-read the entire document. Bump `last-reviewed` only if the content is still correct; changing the date alone does not satisfy the check. Record the completed review for explicit paths:

```bash
skeleton audit docs --paths=docs/example.md --fix=doc-meta --confirm-reviewed
skeleton audit docs --paths=docs/example.md --fix=doc-meta --confirm-reviewed --dry-run
```

If the diagnostic code is `review-document-changed` or `review-dependency-changed`, hash proof found exact byte drift. Plain-text output prints one `file: error:` diagnostic per failed document and a `changed:` line for the files that triggered it. Review the whole document against every current `review-deps` dependency, then run the command above. Do not hand-edit the lockfile.

**Re-read cadence** — message mentions `exceeds re-read cadence` / `daysUntilStale`.

**Cause:** Calendar age of `last-reviewed` (even if the file was not edited). This is process hygiene, not proof the text is wrong.

**Fix:** Re-affirm the paper and bump the date, or raise `daysUntilStale` if the cadence is too tight. Warn-only unless `--strict`.

## Still stuck?

- [Validation](validation.md) — routing and CI two-pass
- [Audit](audit.md) — suites and global vs path-scoped
- [Config](config.md) — scan keys
- [AGENTS.md](../../AGENTS.md) — contributor validation split for this repo
