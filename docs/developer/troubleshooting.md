# Troubleshooting

**Source of truth for** common Skeleton validation and hook failures.

<!-- doc-meta: owner=eng | last-reviewed=2026-07-15 -->

Decision table and routing: [validation](validation.md). Day-one setup: [getting started](getting-started.md).

## `validate changed: all paths were skipped`

**Cause:** Every input was code/config (`.ts`, `.py`, `package.json`, etc.). Skeleton does not validate app code.

**Fix:** Run your repo’s code gates, for example:

```bash
bun test
bun run typecheck
bun run build
```

(or the equivalent npm/Nx scripts). Pass docs/skill paths if you intended SSOT validation.

## Skill-only paths exit non-zero

**Cause:** Changes under a skill tree (`SKILL.md` or skill-tree markdown) are not covered by path-scoped docs audit.

**Fix:**

```bash
skeleton audit skills
```

Under CI, `skeleton validate changed --base origin/main` still applies global skill rules.

## Plugin policy YAML redirects

**Cause:** You changed YAML matched by a plugin `policies` glob. Local validate schema-checks then fails closed so prose coverage is not assumed.

**Fix (local / pre-commit):**

```bash
skeleton audit docs
skeleton audit skills
```

`audit self` alone is not enough if skill trees are under `scan.exclude`. CI `--base` / `validate:ci` proves docs + skills without the redirect.

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

## Customize hook not injecting

**Checklist:**

1. Package installed: `node_modules/@csark0812/skeleton` present (or linked in monorepos). Init writes a cwd-local `node …/dist/cli.js hook customize` command, so `PATH` / `node_modules/.bin` is not required.
2. Init hooks present: `.cursor/hooks.json`, `.claude/settings.json`, and/or `.codex/hooks.json` contain a skeleton `hook customize` command (or the legacy `customize-on-skill-read` entrypoint).
3. Host matcher matches the tool: Cursor `Read`, Claude `Read`/`Skill`, Codex `read_file`. Grep/shell never inject.
4. Slug resolve works:

```bash
skeleton customize resolve <slug>
```

If resolve prints content but the IDE still skips inject, re-run `npx skeleton init` (or `--force-hooks` if you intentionally overrode the skeleton-owned hook fields). Details: [customize](customize.md).

## Plugin `.mjs` missing or stale

**Cause:** Runtime loads only the sibling `.mjs`; authors must commit source **and** build artifact.

**Fix:**

```bash
skeleton build-plugin
skeleton build-plugin --check   # CI: fail if missing, unstamped, or content-stale
```

Requires Bun on `PATH` for `build-plugin` (not for `--check`). See [plugins](plugins.md).

## Stale `last-reviewed` warnings

**Cause:** Registry-listed / meta docs changed after the date in `<!-- doc-meta: … -->`.

**Fix:** Bump the date after review, or autofix:

```bash
skeleton audit docs --fix=doc-meta
skeleton audit docs --fix=doc-meta --dry-run
```

## Still stuck?

- [Validation](validation.md) — routing and CI two-pass
- [Audit](audit.md) — suites and global vs path-scoped
- [Config](config.md) — scan keys
- [AGENTS.md](../../AGENTS.md) — contributor validation split for this repo
