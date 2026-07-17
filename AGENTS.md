# Agent entry (skeleton)

**Source of truth for** agent cold-start in this repo.

<!-- doc-meta: owner=eng | last-reviewed=2026-07-17 -->

SSOT audit CLI (`@csark0812/skeleton`). Not an app — no long-lived server.

## Prerequisites

- Bun `1.2.x` (see `packageManager` in `package.json`; CI pins `1.2.21`)
- Node ≥ 22 for `node dist/cli.js` / consumers
- No runtime env vars required (see `.env.example`)

## First hour

```bash
bun install
bun run check
```

`bun run check` = lint + test + typecheck + build + audit:self. Shorthand help: `bun start`.

Scoped code check (fast):

```bash
bun test ./src/audit/__tests__/banned.test.ts
bun test ./tests/smoke.test.ts
```

## Validation split

| Change type                                 | Run                                                                                                                                                        |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Docs / config / registry (non-policy)       | `bun run validate:changed -- <path>` or `bun run audit:self`                                                                                               |
| Plugin-wired policy YAML under `.skeleton/` | `bun run validate:changed -- <path>` (local → `audit docs` **and** `audit skills`; `audit self` alone is not enough — excluded skill trees stay uncovered) |
| Owned skill body (`SKILL.md` trees)         | `bun run audit:skills` (path-scoped validate exits non-zero for owned skill paths — alone or mixed with docs — and redirects here; `audit self` does not cover excluded skill trees) |
| Foreign / lockfile-synced skill body        | skipped — lint in the owning skills/toolbox repo (`skills-lock.json` / `skillOwnership`)                                                                   |
| TypeScript under `src/`                     | `bun test` (or scoped path) + `bun run typecheck` + `bun run build` (+ `bun run lint` or `bun run check`)                                                  |

`validate:changed` **skips** `.ts`/`.tsx`/`.js`/`.jsx`/`.mjs`/`.cjs`/`.py` and command-config JSON (`package.json`, `project.json`). That is intentional — code stays outside the SSOT router. If every path is skipped, it exits non-zero and points you at `bun test` + `bun run typecheck` + `bun run build`. Owned skill paths (alone or mixed with docs) exit non-zero without `--base` and point at `audit skills`; foreign lockfile skills are skipped. Plugin-wired policy YAML (matched by a plugin `policies` glob) schema-checks; local fails closed to `audit docs` **and** `audit skills` (`audit self` covers docs + `.skeleton` but not excluded skill trees), while `--base` runs full docs prose plus path-scoped skills prove over **owned** skill-tree markdown. Other `.skeleton/**` YAML (not `config.yaml`) fails if not wired to a plugin. Missing explicit paths also exit non-zero.

Optional local hooks: install [pre-commit](https://pre-commit.com/) (`brew install pre-commit` or `pipx install pre-commit`), then `pre-commit install`.

Behavioral A/B dogfood (live Cursor, not part of `bun run check`): [agent-suites/README.md](agent-suites/README.md) · [refs/llm-harness.md](refs/llm-harness.md).

Consumer-facing decision table and routing: [docs/developer/validation.md](docs/developer/validation.md). Common failures: [docs/developer/troubleshooting.md](docs/developer/troubleshooting.md). Day-one setup: [docs/developer/getting-started.md](docs/developer/getting-started.md).

## Layout

- CLI: `src/`
- Smoke tests: `tests/` (plus colocated `src/**/__tests__`)
- Package skill (ops manual): `skeleton/SKILL.md`
- Config: `.skeleton/config.yaml`, `.skeleton/registry.md`
- Local `skills add` installs land under `.agents/` / `.claude/` (gitignored; excluded from scan)

## Docs

[README](README.md) · [getting started](docs/developer/getting-started.md) · [config](docs/developer/config.md) · [validation](docs/developer/validation.md) · [troubleshooting](docs/developer/troubleshooting.md) · [audit](docs/developer/audit.md) · [install](docs/developer/install.md)
