# Validation

**Source of truth for** skeleton validate changed routing.

<!-- doc-meta: owner=eng | last-reviewed=2026-07-13 -->

## Commands

```bash
skeleton validate changed              # git diff HEAD
skeleton validate changed --staged     # pre-commit
skeleton validate changed --base origin/main  # CI merge-base diff
```

## Path routing

| Path                                                                                | Action                                                                                                                                                                    |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Docs in scan perimeter                                                              | `audit docs` (path-scoped)                                                                                                                                                |
| Skill trees (`SKILL.md` perimeter)                                                  | exits non-zero → run `audit skills` (or CI `--base` globals); path-scoped skills include `prose-policy` when plugins supply policies                                      |
| Plugin-wired policy YAML under `.skeleton/`                                         | YAML matched by a plugin `policies` glob: schema check; local → exit non-zero (run `audit docs` / `self`); `--base` → full `audit docs` to prove prose against the corpus |
| Other `.skeleton/**` YAML (not `config.yaml`, not plugin-wired)                     | exits non-zero — file is not referenced by any plugin `policies` glob                                                                                                     |
| `.sh`, `.bash`, `.zsh`                                                              | shellcheck or `bash -n`                                                                                                                                                   |
| Other `.json`                                                                       | JSONC-tolerant syntax check                                                                                                                                               |
| `.ts`, `.tsx`, `.js`, `.jsx`, `.mjs`, `.cjs`, `.py`, `package.json`, `project.json` | skip (see below)                                                                                                                                                          |

Skipped paths are intentional: skeleton validates SSOT/docs only on the path-scoped lane. If **every** input path is skipped, `validate changed` exits non-zero and prints the code gates to run. Skill-only paths also exit non-zero (skill-body rules are global). Policy YAML is plugin-glob SSOT only (same as runtime `loadPlugins`): unwired `.skeleton/**/*.yaml` fails loud. Wired policy changes still need a full docs prose pass for new patterns — local/pre-commit redirects; CI `--base` runs that full docs audit inline. Mixed doc+code paths still skip code and audit the rest.

In this repo, code gates are:

```bash
bun test
bun run typecheck
bun run build
```

## CI two-pass

`validate:ci` (`--base`) runs **global rules first** (registry, banned, coverage-gaps, scan-roots, skill-index, generated-references), then path-scoped audit on changed files. When the diff includes **wired policy YAML**, it also runs a full `audit docs` (corpus prose-policy) after schema checks — CI proves coverage instead of redirecting. Pre-commit stays path-scoped and still fail-closes on wired policy changes.

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
