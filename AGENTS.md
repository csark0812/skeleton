# Agent entry (skeleton)

**Source of truth for** agent cold-start in this repo.

<!-- doc-meta: owner=eng | last-reviewed=2026-07-13 -->

SSOT audit CLI (`@csark0812/skeleton`). Not an app — no long-lived server.

## Prerequisites

- Bun `1.2.x` (see `packageManager` in `package.json`; CI pins `1.2.21`)
- Node ≥ 22 for `node dist/cli.js` / consumers

## First hour

```bash
bun install
bun run lint
bun test
bun run typecheck
bun run build
bun run audit:self
```

Scoped code check (fast):

```bash
bun test ./src/audit/__tests__/banned.test.ts
```

## Validation split

| Change type | Run |
| ----------- | --- |
| Docs / config / registry | `bun run validate:changed -- <path>` or `bun run audit:self` |
| Skill body (`SKILL.md` trees) | `bun run audit:skills` or `bun run audit:self` (path-scoped validate is a no-op) |
| TypeScript under `src/` | `bun test` (or scoped path) + `bun run typecheck` + `bun run build` |

`validate:changed` **skips** `.ts`/`.tsx`/`.js`/`.jsx`/`.mjs`/`.cjs`/`.py` and command-config JSON (`package.json`, `project.json`). That is intentional — code stays outside the SSOT router. If every path is skipped, it exits non-zero and points you at `bun test` + `bun run typecheck`. Skill-only paths exit non-zero and point at `audit skills`.

Optional local hooks: install [pre-commit](https://pre-commit.com/) (`brew install pre-commit` or `pipx install pre-commit`), then `pre-commit install`.

## Layout

- CLI: `src/`
- Package skill (ops manual): `skeleton/SKILL.md`
- Config: `.skeleton/config.yaml`, `.skeleton/registry.md`
- Local `skills add` installs land under `.agents/` / `.claude/` (gitignored; excluded from scan)

## Docs

[README](README.md) · [validation](docs/developer/validation.md) · [audit](docs/developer/audit.md) · [install](docs/developer/install.md)
