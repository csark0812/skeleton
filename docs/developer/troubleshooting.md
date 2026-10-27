# Troubleshooting

<!-- source-of-truth: common Skeleton validation failures -->

<!-- doc-meta: owner=eng -->

<!-- review-deps: paths=src/validate/**,src/audit/run.ts,src/attest/**,src/audit/core/review-proof.ts,src/audit/rules/review-deps.ts -->

Failures usually come from `runValidateChanged` / `codeValidationHint` or `runAudit` / `parseAuditArgs`.

To learn the lane without an audit, run `skeleton route` or `skeleton route <path>`.

Decision table and routing: [validation](validation.md). Day-one setup: [getting started](getting-started.md).

## `uncovered-changed-path`

**Cause:** A live coverage-candidate file changed and no scanned paper lists it in `review-deps`. Deleted files do not fire this code.

**Fix:** Add a `review-deps` path or glob on the owning paper. Then re-read that paper and attest it.

The same error fires on local, `--staged`, and `--base` runs. A mixed docs commit does not hide it.

## `attest`: "Commit these first, then attest"

**Cause:** A review records committed bytes. The document, one of its dependencies, or an untracked file that a dependency glob matches differs from HEAD.

**Fix:** Commit the edit (or remove the stray file), then attest. `--staged` never checks review proof, because the review is a commit after the staged one; `validate changed --base` checks it.

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

**Changed since review** — code `review-document-changed` or `review-dependency-changed`.

**Cause:** No review reachable from HEAD recorded the document's current bytes and `review-deps` bytes, so no recorded review covers it.

**Fix:** Re-read the entire document against every current dependency. Attest it only if the content is still correct:

```bash
skeleton attest docs/example.md
skeleton attest docs/example.md --dry-run
```

Plain-text output prints one `file: error:` diagnostic per failed document and a `changed:` line for the files that triggered it. Naming a dependency compares it with its content at the latest attest commit; when that commit cannot say, the line reads `changed: review dependency set`.

**"Text unchanged since the last review"** — attestation refused. A dependency changed but the document did not. Check the document's claims against the change, then attest with `--reason "<what you checked>"`, or fix the text and attest without it.

**Combined text not reviewed** — code `review-merged-unattested`. Two branches each reviewed the document and both merged, so no one has read the result. A warning for repository-wide audits; an error once a change touches the document. Re-read the combined text, then attest it.

**Dependency warnings** — `review-dependency-broad`: a document depends on a whole `package.json`; name the keys it describes (`package.json#scripts`). `review-dependency-cycle`: documents depend on each other; replace the document dependency with a link.

**Missing proof** — code `review-proof-missing`. The document has never been attested. Review it, then run the command above.

**Retired lock** — code `review-lock-retired`. A Skeleton 8 `.skeleton/review-lock.toml` is still present and is no longer read. Run `skeleton attest --migrate` once ([config](config.md#reviewproof)). Skeleton 5, 6, or 7 proof must first go through Skeleton 8 `attest --repair`.

**History unavailable** — code `review-history-unavailable`. The clone is shallow, so a missing review proves nothing. Fetch full history (`git fetch --unshallow`, or `fetch-depth: 0` in CI).

**Review lines dropped by a squash merge** — a squash message without the `Skeleton-Reviewed:` lines fails the documents on the default branch. Keep commit messages when squash-merging, or attest again on the default branch.

**Re-read cadence** — code `review-cadence-exceeded`.

**Cause:** The attest commit of the review that covers the document's current bytes is older than `daysUntilStale` (even if nothing changed). This is process hygiene, not proof the text is wrong.

**Fix:** Re-read and attest the paper again, or raise `daysUntilStale` if the cadence is too tight. Warn-only unless `--strict`.

## Still stuck?

- [Validation](validation.md) — routing and CI two-pass
- [Audit](audit.md) — suites and global vs path-scoped
- [Config](config.md) — scan keys
- [AGENTS.md](../../AGENTS.md) — contributor validation split for this repo
