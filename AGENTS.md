# Agent entry (skeleton)

<!-- source-of-truth: agent cold-start in this repo -->

<!-- doc-meta: owner=eng | last-reviewed=2026-08-24 -->

<!-- review-deps: paths=src/cli.ts,package.json -->

SSOT audit CLI (`@csark0812/skeleton`). Not an app — no long-lived server. Day-one commands from `src/cli.ts`: `catalog`, `audit`, `validate`, `init` (also `build-plugin` / `references` when needed). Prefer `bun src/cli.ts` in this repo.

## Doc routing (before long reads)

1. If `.skeleton/catalog.md` is missing, run `bun src/cli.ts catalog` (or `skeleton catalog`).
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

| Change type                                 | Run                                                                                                                                                        |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Docs / config (non-policy)                  | `bun run validate:changed -- <path>` or `bun run audit:self`                                                                                               |
| Plugin-wired policy YAML under `.skeleton/` | `bun run validate:changed -- <path>` (local → `audit docs` **and** `audit skills`; `audit self` alone is not enough — excluded skill trees stay uncovered) |
| Owned skill body (`SKILL.md` trees)         | `bun run audit:skills` (path-scoped validate exits non-zero for owned skill paths — alone or mixed with docs — and redirects here; `audit self` does not cover excluded skill trees) |
| Foreign / lockfile-synced skill body        | skipped — lint in the owning skills/toolbox repo (`skills-lock.json` / `skillOwnership`)                                                                   |
| TypeScript under `src/`                     | `bun test` (or scoped path) + `bun run typecheck` + `bun run build`; `validate:changed` also discovers and audits docs that target the changed code                                            |

`validate:changed` classifies code paths but leaves their correctness to `bun test` + `typecheck` + `build`. It scans `review-deps` markers and adds every document linked to any changed dependency to the docs audit. With hash review proof, changed dependency bytes invalidate the recorded review. Without hash mode, the linked document must co-change with a current explicit review attestation. Code-only changes with no linked docs exit non-zero locally and print the native gates. Under CI `--base`, code-only changes still run global rules; keep the TS lane in CI separately. Owned skill paths (alone or mixed with docs) exit non-zero without `--base` and point at `audit skills`; foreign lockfile skills are skipped. Plugin-wired policy YAML (matched by a plugin `policies` glob) schema-checks; local fails closed to `audit docs` **and** `audit skills` (`audit self` covers docs + `.skeleton` but not excluded skill trees), while `--base` runs full docs prose plus path-scoped skills prove over **owned** skill-tree markdown. Other `.skeleton/**` YAML (not `config.yaml`) fails if not wired to a plugin. Missing explicit paths also exit non-zero.

Never bump `last-reviewed` as a mechanical cleanup. After a complete re-read, attest only explicit paths:

```bash
bun src/cli.ts audit docs --paths=docs/a.md --fix=doc-meta --confirm-reviewed
```

Optional local hooks: install [pre-commit](https://pre-commit.com/) (`brew install pre-commit` or `pipx install pre-commit`), then `pre-commit install`. Customize IDE hooks from `skeleton init` are optional — not required for audit.

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
