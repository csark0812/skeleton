# Validation

<!-- source-of-truth: skeleton validate changed routing -->

<!-- doc-meta: owner=eng | last-reviewed=2026-08-19 -->

<!-- code-fit: targets=src/validate/changed.ts surface=runValidateChanged,evaluateValidateChanged,ValidateChangedOptions,codeValidationHint -->

Router for changed paths: `runValidateChanged` / `evaluateValidateChanged` (`ValidateChangedOptions`). Code paths get a `codeValidationHint` for native gates and also drive `code-fit` document-impact discovery. Package-manager detection may mention `bun` / `npm` / `pnpm` / `yarn`.

## When you changed X, run Y

| You changed                                               | Run                                                                                                    |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Docs, catalog, non-policy `.skeleton/` / `skeleton.toml`  | `skeleton validate changed <path>` or `skeleton audit self`                                            |
| Owned skill body (`SKILL.md` trees authored in this repo) | `skeleton audit skills` (path-scoped validate exits non-zero and redirects here)                       |
| Foreign / lockfile-synced skill body                      | skipped — lint in the owning skills/toolbox repo                                                       |
| Plugin-wired policy YAML under `.skeleton/`               | Local: `skeleton audit docs` **and** `skeleton audit skills`. CI: `validate:ci` / `--base` proves both |
| TypeScript / app code                                     | Repo-native gates plus Skeleton audits for documents linked by `code-fit`                              |
| `package.json` / `project.json`                           | Repo-native gates; no docs dependency routing                                                          |
| Missing paths or code paths with no impacted documents    | Pass real paths, or use `--staged` / `--base`; run the printed native gates                            |

Common failures: [troubleshooting](troubleshooting.md). Suites and rule scoping: [audit](audit.md).

## Commands

```bash
skeleton validate changed              # git diff HEAD
skeleton validate changed --staged     # pre-commit
skeleton validate changed --base origin/main  # CI merge-base diff
skeleton validate changed --json              # one versioned result document
```

## Path routing

| Path                                                                                | Action                                                                                                                                                                           |
| ----------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Docs in scan perimeter                                                              | `audit docs` (path-scoped)                                                                                                                                                       |
| Owned skill trees (`SKILL.md` perimeter)                                            | without `--base`, exits non-zero → run `audit skills` (including when mixed with docs); path-scoped skills include `prose-policy` when plugins supply policies under CI `--base` |
| Foreign skill trees (`skills-lock.json` github / non-local provenance)              | skip with a log line — body lint belongs upstream                                                                                                                                |
| Plugin-wired policy YAML under `.skeleton/`                                         | Schema check; local → exit non-zero (run `audit docs` **and** `audit skills`); `--base` → full docs + path-scoped skills over **owned** skill-tree markdown                      |
| Other `.skeleton/**` YAML (not `config.yaml`, not plugin-wired)                     | exits non-zero — not referenced by any plugin `policies` glob                                                                                                                    |
| `.sh`, `.bash`, `.zsh`                                                              | shellcheck or `bash -n`                                                                                                                                                          |
| Other `.json`                                                                       | JSONC-tolerant syntax check                                                                                                                                                      |
| `.ts`, `.tsx`, `.js`, `.jsx`, `.mjs`, `.cjs`, `.py`                               | classify as code; discover and audit scanned docs whose `code-fit` target matches; still require native code gates                                                            |
| `package.json`, `project.json`                                                     | skip to native code gates                                                                                                                                                       |

### Code paths and impacted documents

Skeleton does not claim to validate application code. It classifies code paths, prints the repo-native gates, and builds an exact reverse dependency map from `code-fit` targets to scanned documents.

- Hash mode: changed code bytes make the linked document's `review-proof` entry invalid until explicit re-review and attestation.
- Date mode: a linked document must be included in the changed set and carry today's explicit review date.
- No linked document: a local code-only invocation exits non-zero and prints native gates. Under `--base`, global Skeleton rules still run; the separate code job remains required.

In this repo:

```bash
bun test
bun run typecheck
bun run build
```

Mixed doc+code paths audit both directly changed and discovered impacted documents. JSON output exposes `classification.code` and `impactedDocuments`, including the exact target that caused each impact.

### Skill-body paths

Skill bodies are not path-scoped on the docs lane.

**Owned** skill paths (alone or mixed with docs) exit non-zero without `--base` and point at `skeleton audit skills`. Under CI `--base`, global skill rules and (when relevant) owned skills prose prove still run.

**Foreign** skills (`skills-lock.json` entries with `sourceType` other than `local`, e.g. `github`) are skipped so consumer repos don't double-lint synced toolbox copies — including doc-meta on SSOT-bearing skill `references/**` paths. Override with `skillOwnership.ownedSlugs` / `foreignSlugs` — see [config](config.md#skillownership).

`audit self` covers the scan corpus; excluded owned skill trees still need `audit skills`. Customize overlays under `.skeleton/customize/` stay in the consumer audit corpus.

### Plugin policy YAML

Policy YAML is plugin-glob SSOT only (same as runtime `loadPlugins`):

- Unwired `.skeleton/**/*.yaml` (not `config.yaml`) fails loud — wire it via a plugin `policies` glob or move it.
- Wired policy changes need a full docs **and** skills prose pass for new patterns.
- Local / pre-commit: schema-check then fail-closed with a redirect to both audits (`audit self` alone does not cover excluded skill trees).
- CI `--base`: full `audit docs` plus path-scoped `audit skills` over **owned** skill-tree markdown (including `references/**` under `scan.exclude`; foreign lock skills stay ignored).

### CI two-pass

`validate:ci` (`--base`) runs **global rules first** (`deny.paths` via rule `banned`, coverage-gaps, scan-roots, skill-index, generated-references, ssot, near-duplicate, ssot-summary), then path-scoped audit on changed files. When the diff includes **wired policy YAML**, CI also runs the full docs + skills prove described above instead of redirecting. Pre-commit stays path-scoped and still fail-closes on wired policy changes.

## Machine-readable result

`validate changed --json` emits one object with input paths, classification buckets, impacted documents, nested audit results, and router diagnostics. Validate it with `schemas/result.schema.json`; TypeScript consumers can import `ValidateChangedResult` from `@csark0812/skeleton/result-types`.

## Shared references

When skills share reference docs, keep canonical files in `.skeleton/references/` and materialize self-contained copies into each skill:

```bash
skeleton references sync    # write generated copies + rewrite ../references/ links
skeleton references check   # verify copies match canonical sources
```

Generated copies carry a provenance header:

```markdown
<!-- skeleton: generated-reference
source: .skeleton/references/dialogue-contract.md
redundancy: intentional
-->
```

Edit canonical files only. Run `references sync` after changes. The `generated-references` audit rule runs in `audit skills` / `audit self`.

See [audit](audit.md).
