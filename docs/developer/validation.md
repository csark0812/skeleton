# Validation

**Source of truth for** skeleton validate changed routing.

<!-- doc-meta: owner=eng | last-reviewed=2026-07-17 -->

## When you changed X, run Y

| You changed                                               | Run                                                                                                    |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Docs, registry, non-policy `.skeleton/` config            | `skeleton validate changed <path>` or `skeleton audit self`                                            |
| Owned skill body (`SKILL.md` trees authored in this repo) | `skeleton audit skills` (path-scoped validate exits non-zero and redirects here)                       |
| Foreign / lockfile-synced skill body                      | skipped — lint in the owning skills/toolbox repo                                                       |
| Plugin-wired policy YAML under `.skeleton/`               | Local: `skeleton audit docs` **and** `skeleton audit skills`. CI: `validate:ci` / `--base` proves both |
| TypeScript / app code / `package.json`                    | Repo-native gates (`test` + `typecheck` + `build`) — not Skeleton                                      |
| Missing paths or only skipped code paths                  | Pass real paths, or use `--staged` / `--base`; for all-skipped code see below                          |

Common failures: [troubleshooting](troubleshooting.md). Suites and rule scoping: [audit](audit.md).

## Commands

```bash
skeleton validate changed              # git diff HEAD
skeleton validate changed --staged     # pre-commit
skeleton validate changed --base origin/main  # CI merge-base diff
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
| `.ts`, `.tsx`, `.js`, `.jsx`, `.mjs`, `.cjs`, `.py`, `package.json`, `project.json` | skip (see below)                                                                                                                                                                 |

### Skipped paths

Intentional — Skeleton validates SSOT/docs only. If **every** input path is skipped, `validate changed` exits non-zero and prints the code gates to run.

In this repo:

```bash
bun test
bun run typecheck
bun run build
```

Mixed doc+code paths still skip code and audit the docs portion.

### Skill-body paths

Skill bodies are not path-scoped on the docs lane.

**Owned** skill paths (alone or mixed with docs) exit non-zero without `--base` and point at `skeleton audit skills`. Under CI `--base`, global skill rules and (when relevant) owned skills prose prove still run.

**Foreign** skills (`skills-lock.json` entries with `sourceType` other than `local`, e.g. `github`) are skipped so consumer repos don't double-lint synced toolbox copies — including doc-meta on registry-cited skill `references/**` paths. Override with `skillOwnership.ownedSlugs` / `foreignSlugs` — see [config](config.md#skillownership).

`audit self` covers the scan corpus; excluded owned skill trees still need `audit skills`. Customize overlays under `.skeleton/customize/` stay in the consumer audit corpus.

### Plugin policy YAML

Policy YAML is plugin-glob SSOT only (same as runtime `loadPlugins`):

- Unwired `.skeleton/**/*.yaml` (not `config.yaml`) fails loud — wire it via a plugin `policies` glob or move it.
- Wired policy changes need a full docs **and** skills prose pass for new patterns.
- Local / pre-commit: schema-check then fail-closed with a redirect to both audits (`audit self` alone does not cover excluded skill trees).
- CI `--base`: full `audit docs` plus path-scoped `audit skills` over **owned** skill-tree markdown (including `references/**` under `scan.exclude`; foreign lock skills stay ignored).

### CI two-pass

`validate:ci` (`--base`) runs **global rules first** (registry, banned, coverage-gaps, scan-roots, skill-index, generated-references), then path-scoped audit on changed files. When the diff includes **wired policy YAML**, CI also runs the full docs + skills prove described above instead of redirecting. Pre-commit stays path-scoped and still fail-closes on wired policy changes.

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
