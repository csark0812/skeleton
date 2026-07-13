# Customize

**Source of truth for** skill customize overrides via hooks.

<!-- doc-meta: owner=eng | last-reviewed=2026-07-13 -->

## Layout

```
.skeleton/customize/<slug>.md
```

`skeleton init` wires IDE hooks to inject customize content on skill reads (and Claude `Skill` tool invoke).

## Inject gates

| Triggers inject | Does not inject |
| --- | --- |
| `Read` / `read_file` of a path ending in `/SKILL.md` | `Grep`, shell `cat`/`head` |
| `Read` / `read_file` under a skill tree (`.claude/skills/<slug>/**`, `.agents/skills/<slug>/**`, or flat `<slug>/references/**` when that skill exists) | Non-skill paths (no resolvable slug) |
| Claude `Skill` tool (slug from tool input) | Missing `node_modules/@csark0812/skeleton` (hooks no-op / fail) |

### Host matchers (init templates)

| Host | Matcher(s) |
| --- | --- |
| Cursor | `Read` only (no Claude-style Skill tool) |
| Claude Code | `Read` + `Skill` |
| Codex | `read_file` only |

## `alwaysInclude`

In `.skeleton/config.yaml`:

```yaml
customize:
  alwaysInclude:
    - shared-agent-references.md
```

On every inject for slug `X`, the hook and `skeleton customize resolve X` concatenate:

1. `.skeleton/customize/X.md` (if present and non-empty)
2. Each listed basename under `.skeleton/customize/` (skip if it is the same file as `X.md`)

If the slug file is missing or empty but `alwaysInclude` resolves content, inject still fires.

Recommended for toolbox consumers: put the consumer `references/*` → docs remap table in `shared-agent-references.md` and list it under `alwaysInclude` so agents do not need a second hop.

## Manual resolve

```bash
skeleton customize resolve code-review
skeleton customize resolve code-review --json
# or, from a consumer repo: bunx skeleton customize resolve code-review
```

There is no `bun run skeleton customize …` script by default — use the `skeleton` bin from `@csark0812/skeleton`.

## Register customize files

```bash
skeleton register .skeleton/customize/code-review.md
```

Do not edit synced toolbox `SKILL.md` files — override in `.skeleton/customize/`.
