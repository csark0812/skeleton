# Agent entry (skeleton)

<!-- source-of-truth: agent cold-start in this repo -->

<!-- doc-meta: owner=eng | last-reviewed=2026-09-13 -->

<!-- review-deps: paths=src/cli.ts,package.json -->

SSOT audit CLI (`@csark0812/skeleton`). Not an app — no long-lived server. Day-one commands from `src/cli.ts`: `catalog`, `audit`, `validate`, `init` (also `build-plugin` when needed). Prefer `bun src/cli.ts` in this repo.

## Doc routing (before long reads)

1. Local `audit` / `validate` writes `.skeleton/catalog.md` (skipped when `CI=true`).
2. Skim the catalog summaries.
3. For a hit, read only the source-of-truth line / first ~20 lines of that file.
4. Open the full doc only if it is truly relevant.

Catalog honesty is enforced by `audit docs` (`ssot-summary` / near-dupe) — do not assume one-liners stay accurate without that gate.

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

| Change type                                 | Run                                                                                          |
| ------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Docs / config (non-policy)                  | `bun run validate:changed -- <path>` or `bun run audit:self`                                 |
| Plugin-wired policy YAML under `.skeleton/` | `bun run validate:changed -- <path>` (runs full docs and owned-skill prose)                  |
| Owned skill body (`SKILL.md` trees)         | `bun run validate:changed -- <path>` (runs `audit skills`) or `bun run audit:skills`         |
| Foreign / lockfile-synced skill body        | skipped — lint in the owning skills/toolbox repo (`skills-lock.json` / `skillOwnership`)     |
| TypeScript under `src/`                     | `bun test` + `bun run typecheck` + `bun run build`. `validate:changed` fails uncovered paths |

`validate:changed` classifies code paths and leaves correctness to `bun test` + `typecheck` + `build`. It scans `review-deps` and audits every linked document. A coverage-candidate path with no owning paper fails with `uncovered-changed-path` on local and `--base` runs. Mixed commits do not hide that. Hash review proof invalidates a paper when dependency bytes change. Date mode requires the paper in the change set with today's review date. `--staged` reads index bytes and fails `stage-required` when an impacted paper or the hash lockfile differs from HEAD and is not staged. Owned skill paths run the skills suite. Wired policy YAML runs full docs plus owned-skill prose. Foreign lockfile skills are skipped. Other `.skeleton/**` YAML (not `config.yaml`) fails if not wired to a plugin. Missing explicit paths also exit non-zero.

Never bump `last-reviewed` as a mechanical cleanup. After a complete re-read, attest only explicit paths:

```bash
bun src/cli.ts audit docs --paths=docs/a.md --fix=doc-meta --confirm-reviewed
```

Pre-commit: `.pre-commit-config.yaml` runs `bun src/cli.ts validate changed --staged`. Install [pre-commit](https://pre-commit.com/) once per machine, then `pre-commit install`. Customize IDE hooks from `skeleton init` are optional.

Behavioral A/B dogfood (live Cursor, not part of `bun run check`): [agent-suites/README.md](agent-suites/README.md) · [refs/llm-harness.md](refs/llm-harness.md).

Consumer-facing decision table and routing: [docs/developer/validation.md](docs/developer/validation.md). Common failures: [docs/developer/troubleshooting.md](docs/developer/troubleshooting.md). Day-one setup: [docs/developer/getting-started.md](docs/developer/getting-started.md).

## Layout

- CLI: `src/`
- Smoke tests: `tests/` (plus colocated `src/**/__tests__`)
- Package skill (ops manual): `skeleton/SKILL.md`
- Config: `skeleton.toml` (preferred); legacy `.skeleton/config.yaml` still loads
- Local `skills add` installs land under `.agents/` / `.claude/` (gitignored; excluded from scan)

## Docs

[README](README.md) · [getting started](docs/developer/getting-started.md) · [config](docs/developer/config.md) · [validation](docs/developer/validation.md) · [troubleshooting](docs/developer/troubleshooting.md) · [audit](docs/developer/audit.md) · [install](docs/developer/install.md)
