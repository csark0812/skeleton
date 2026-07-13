# Agent entry (skeleton)

**Source of truth for** agent cold-start in this repo.

<!-- doc-meta: owner=eng | last-reviewed=2026-07-13 -->

SSOT audit CLI (`@csark0812/skeleton`). Not an app — no long-lived server.

## First hour

```bash
bun install
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

| Change type | Command |
| ----------- | ------- |
| Docs / skills / config / registry | `bun run validate:changed -- <path>` or `bun run audit:self` |
| TypeScript under `src/` | `bun test` (or scoped path) + `bun run typecheck` |

`validate:changed` **skips** `.ts`/`.tsx`/`.js`/`.jsx`/`.mjs`/`.cjs`/`.py` and command-config JSON (`package.json`, `project.json`). That is intentional — code stays outside the SSOT router. If every path is skipped, it exits non-zero and points you at `bun test` + `bun run typecheck`.

## Layout

- CLI: `src/`
- Package skill (ops manual): `skeleton/SKILL.md`
- Config: `.skeleton/config.yaml`, `.skeleton/registry.md`
- Local `skills add` installs land under `.agents/` / `.claude/` (gitignored; excluded from scan)

## Docs

[README](README.md) · [validation](docs/developer/validation.md) · [audit](docs/developer/audit.md) · [install](docs/developer/install.md)
