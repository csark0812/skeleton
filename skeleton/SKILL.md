---
name: skeleton
description: Agent ops manual for skeleton-enabled repos — init, catalog, audit, optional customize hooks, and toolbox skill overrides. Use when editing skeleton.toml / .skeleton/, syncing toolbox skills, or running skeleton CLI.
---

# Skeleton

<!-- source-of-truth: maintaining a skeleton-enabled repo -->

<!-- doc-meta: owner=eng | last-reviewed=2026-08-16 -->

## Agent doc routing (token-cheap)

1. If `.skeleton/catalog.md` is missing, run `skeleton catalog`.
2. Skim the catalog (path + one-line summary).
3. For a candidate, read only the `source-of-truth` line / first ~20 lines.
4. Open the full paper only if that line is truly relevant.

Human docs: [getting started](https://github.com/csark0812/skeleton/blob/main/docs/developer/getting-started.md) · [config](https://github.com/csark0812/skeleton/blob/main/docs/developer/config.md) · [troubleshooting](https://github.com/csark0812/skeleton/blob/main/docs/developer/troubleshooting.md).

## When to use

- Edit `skeleton.toml` or `.skeleton/customize/<slug>.md`
- Run `skeleton audit`, `skeleton validate`, or `skeleton catalog`
- Sync or update skills from an external toolbox repo
- Avoid editing synced toolbox skill copies in the consumer repo

Catalog honesty is enforced by `audit docs` (`ssot-summary` / near-dupe) — do not assume one-liners stay accurate without that gate.

Doc-meta: one authored `last-reviewed` (human claim). Git is last-edit — no parallel edit stamp. Prefer the “content changed after last-reviewed” warning (review must cover latest edit); `daysUntilStale` is optional re-read cadence. Details: [doc system](https://github.com/csark0812/skeleton/blob/main/docs/developer/doc-system.md#doc-meta).

Not for: normal feature work that only reads toolbox skills (optional customize hooks can inject on skill reads).

## Layout

```
skeleton.toml           # preferred root config (scan, stale, docsLint)
.skeleton/
├── catalog.md          # generated, gitignored — run `skeleton catalog`
├── plugins/            # optional audit plugins (.ts + .mjs)
└── customize/          # per-slug overrides for toolbox-bound skills
    └── <slug>.md
```

Legacy `.skeleton/config.yaml` still loads if no `skeleton.toml` is present.

## Customize hooks (optional)

Hooks are an optional improvement, not required for audit/validate/catalog.

`skeleton init` may merge IDE hooks that run a cwd-local
`node node_modules/@csark0812/skeleton/dist/cli.js hook customize` on skill reads.
Inside this repo the hook runs `bun src/cli.ts hook customize`.

- Hook injects `.skeleton/customize/<slug>.md` when path is `/SKILL.md` **or** under a skill tree
- **Never edit synced toolbox `SKILL.md` files in the consumer repo** — override in `.skeleton/customize/<slug>.md`
- Manual fallback: `skeleton customize resolve <slug>`

Details: [docs/developer/customize.md](https://github.com/csark0812/skeleton/blob/main/docs/developer/customize.md)

## Setup

```bash
npm install -D @csark0812/skeleton
npx skeleton init --skills
```

Edit `skeleton.toml` scan trees for this repo shape.

## Workflow

1. Add `<!-- source-of-truth: one-line summary -->` (or visible `source-of-truth: …`) to canonical docs
2. Run `skeleton catalog`
3. Run `skeleton audit docs` (or `audit self`)

## CLI

| Command                                        | Purpose                                                 |
| ---------------------------------------------- | ------------------------------------------------------- |
| `skeleton audit self`                          | Full docs + config audit (excluded skill trees still need `audit skills`) |
| `skeleton audit docs`                          | Doc audit (SSOT, near-dupe, links, doc-meta, …)         |
| `skeleton audit docs --fix`                    | Autofix doc-meta + anchors + legacy SSOT rewrite        |
| `skeleton audit skills`                        | Skill audit                                             |
| `skeleton catalog` / `catalog --check`         | Write / warn-check gitignored agent catalog             |
| `skeleton build-plugin [--check]`              | Build / verify plugin `.mjs` siblings                   |
| `skeleton validate changed`                    | Changed-file validation                                 |
| `skeleton validate changed --staged`           | Pre-commit (optional)                                   |
| `skeleton validate changed --base origin/main` | CI / PR                                                 |
| `skeleton references sync`                     | Materialize shared references into skills               |
| `skeleton references check`                    | Verify generated references match sources               |
| `skeleton customize resolve <slug>`            | Print merged customize for a skill slug                 |

`register` was removed — add a source-of-truth marker and run `skeleton catalog`.

Plugins: [docs/developer/plugins.md](https://github.com/csark0812/skeleton/blob/main/docs/developer/plugins.md)
