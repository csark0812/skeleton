# Validation

**Source of truth for** skeleton validate changed routing.

<!-- doc-meta: owner=eng | last-reviewed=2026-07-13 -->

## Commands

```bash
skeleton validate changed              # git diff HEAD
skeleton validate changed --staged     # pre-commit
skeleton validate changed --base main  # CI merge-base diff
```

## Path routing

| Path                                         | Action                                      |
| -------------------------------------------- | ------------------------------------------- |
| Docs/skills in scan perimeter                | `audit docs` / `audit skills` (path-scoped) |
| `.sh`, `.bash`, `.zsh`                       | shellcheck or `bash -n`                     |
| Other `.json`                                | JSONC-tolerant syntax check                 |
| `.ts`, `.py`, `package.json`, `project.json` | skip                                        |

This skip list is intentional: skeleton validates SSOT/docs/skills only. In this repo, code gates are separate:

```bash
bun test
bun run typecheck
bun run build
```

## CI two-pass

`validate:ci` (`--base`) runs **global rules first** (registry, banned, coverage-gaps, scan-roots, skill-index, generated-references), then path-scoped audit on changed files. Pre-commit stays path-scoped only.

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
