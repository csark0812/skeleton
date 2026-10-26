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

## `stage-required`

**Cause:** `--staged` saw an impacted paper or the review proof file (`.skeleton/review-lock.toml`) that differs from HEAD and is not in the index.

**Fix:** Stage the attested document and `.skeleton/review-lock.toml`.

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

**Cause:** The document or a `review-deps` dependency no longer matches its entry in `.skeleton/review-lock.toml`, so the recorded review no longer covers it.

**Fix:** Re-read the entire document against every current dependency. Attest it only if the content is still correct:

```bash
skeleton attest docs/example.md
skeleton attest docs/example.md --dry-run
```

Plain-text output prints one `file: error:` diagnostic per failed document and a `changed:` line for the files that triggered it. Naming a dependency needs the commit that recorded the review; without git history the line reads `changed: review dependency set`. Do not hand-edit the proof file.

**"Text unchanged since the last review"** — attestation refused. A dependency changed but the document did not. Check the document's claims against the change, then attest with `--reason "<what you checked>"`, or fix the text and attest without it.

**Lock attested but not staged** — under `--staged`, a review error can mean you attested but did not stage the lock (pre-commit hides unstaged changes). The output then says `git add .skeleton/review-lock.toml`.

**Dependency warnings** — `review-dependency-broad`: a document depends on a whole `package.json`; name the keys it describes (`package.json#scripts`). `review-dependency-cycle`: documents depend on each other; replace the document dependency with a link.

**Missing proof** — code `review-proof-missing`. The document has never been attested. Review it, then run the command above.

**Legacy proof** — code `review-proof-legacy`. Skeleton 5 (`review-lock.json`), 6 (`.skeleton/reviews/`) or 7 (`.skeleton/review-proof`) proof is still present. Run `skeleton attest --repair` once to move it into `.skeleton/review-lock.toml` ([config](config.md#reviewproof)). Attestation refuses to run until then, and likewise while the lock has a merge conflict.

**Merge conflict** — code `review-proof-conflict`. Two branches re-attested the same document, one added or removed an entry next to one the other re-attested, or a merge left duplicate entries. Run `skeleton attest --repair`; it keeps the side that still verifies and drops the rest, so a document whose entry was dropped needs a fresh review.

**Orphaned entry** — code `review-proof-orphan` (warning). A document was renamed or deleted. `skeleton attest --repair` moves or removes the entry. Reported only by full audits, not under `--paths`.

**Malformed proof file** — code `review-proof-invalid`. An entry is not `"<path>" = { doc = "sha256:<16 hex>", deps = "sha256:<16 hex>", note = "…" }` (`deps` and `note` optional), or the lock does not have exactly one `version = 4` line. A Skeleton 7 line file at a custom `[reviewProof] file` path reports `review-proof-legacy` instead; `skeleton attest --repair` migrates it to `.skeleton/review-lock.toml`. Restore the file from git, then re-attest the affected documents.

**Re-read cadence** — code `review-cadence-exceeded`.

**Cause:** The last commit that changed the document's line in `.skeleton/review-lock.toml` (from `git blame`) is older than `daysUntilStale` (even if nothing changed). This is process hygiene, not proof the text is wrong.

**Fix:** Re-read and attest the paper again, or raise `daysUntilStale` if the cadence is too tight. Warn-only unless `--strict`.

## Still stuck?

- [Validation](validation.md) — routing and CI two-pass
- [Audit](audit.md) — suites and global vs path-scoped
- [Config](config.md) — scan keys
- [AGENTS.md](../../AGENTS.md) — contributor validation split for this repo
