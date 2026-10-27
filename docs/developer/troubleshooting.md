# Troubleshooting

<!-- source-of-truth: common Skeleton validation failures -->

<!-- doc-meta: owner=eng -->

<!-- review-deps: paths=src/validate/**,src/audit/run.ts,src/audit/core/stale-documents.ts,src/audit/rules/review-deps.ts -->

Failures usually come from `runValidateChanged` / `codeValidationHint` or `runAudit` / `parseAuditArgs`.

To learn the lane without an audit, run `skeleton route` or `skeleton route <path>`.

Decision table and routing: [validation](validation.md). Day-one setup: [getting started](getting-started.md).

## `uncovered-changed-path`

**Cause:** A live coverage-candidate file changed and no scanned paper lists it in `review-deps`. Deleted files do not fire this code.

**Fix:** Add a `review-deps` path or glob on the owning paper, then re-read that paper and correct it in the same commit.

The same error fires on local, `--staged`, and `--base` runs. A mixed docs commit does not hide it.

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

## Document review failures

See [keeping documents current](doc-system.md#keeping-documents-current).

**Dependency changed, document did not** — code `review-dependency-changed`.

**Cause:** The change alters a file the document lists in `review-deps`, and the document itself is unchanged. It is an error under `--staged` (pre-commit) and a warning for `--base` and working-tree runs. Plain-text output prints `review required` per document with a `changed:` line for each file that triggered it.

**Fix:** Re-read the entire document against the changed files and update it in the same commit. If it is still correct, commit once without the hook (pre-commit framework: `SKIP=<hook id> git commit …`).

**Selector names nothing** — code `unresolved-selector`. A `review-deps` entry such as `package.json#scrpts` or `src/run.ts#oldName` selects nothing, so the document would never be asked for a re-read. Name a key, heading, or symbol that exists, or drop the selector.

**Dependency warnings** — `review-dependency-broad`: a document depends on a whole `package.json`; name the keys it describes (`package.json#scripts`). `review-dependency-cycle`: documents depend on each other; replace the document dependency with a link.

**Re-read cadence** — code `review-cadence-exceeded`.

**Cause:** The document's last commit is older than `daysUntilStale` (even if nothing changed). This is process hygiene, not proof the text is wrong.

**Fix:** Re-read the document against its sources and commit any correction, or raise `daysUntilStale` if the cadence is too tight. Warn-only unless `--strict`.

## Still stuck?

- [Validation](validation.md) — routing and CI two-pass
- [Audit](audit.md) — suites and global vs path-scoped
- [Config](config.md) — scan keys
- [AGENTS.md](../../AGENTS.md) — contributor validation split for this repo
