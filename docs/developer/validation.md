# Validation

**Source of truth for** skeleton validate changed routing.

<!-- doc-meta: owner=eng | last-reviewed=2026-07-11 -->

## Commands

```bash
skeleton validate changed              # git diff HEAD
skeleton validate changed --staged     # pre-commit
skeleton validate changed --base main  # CI merge-base diff
```

## Path routing

| Path | Action |
|------|--------|
| Docs/skills in scan perimeter | `audit docs` / `audit skills` (path-scoped) |
| `.sh`, `.bash`, `.zsh` | shellcheck or `bash -n` |
| Other `.json` | JSONC-tolerant syntax check |
| `.ts`, `.py`, `package.json`, `project.json` | skip |

## CI two-pass

`validate:ci` (`--base`) runs **global rules first** (registry, banned, coverage-gaps, scan-roots, skill-index), then path-scoped audit on changed files. Pre-commit stays path-scoped only.

See [audit](audit.md).
