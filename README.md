# Skeleton

**Source of truth for** Package overview.

<!-- doc-meta: owner=eng | last-reviewed=2026-07-13 -->

Single source of truth (SSOT) linter for agent-enabled repos.

Agent repos accumulate skills, rules, registries, and cross-linked docs faster than anyone can keep them straight by hand. Code repos solved this decades ago with ESLint — deterministic checks, CI gates, fix what you can before merge. Skeleton does the same job for documentation architecture: what's canonical, what links where, what must not exist, and whether your skill overrides are wired correctly.

Skeleton is **not** a runtime agent harness. It does not execute tools, enforce permissions, or manage agent memory. It is a CLI that audits docs, skills, and registries, and fails CI when invariants break.

## Why

Code has linters. Agent repos need the same thing for docs and SSOT.

| Code repos                                              | Agent repos                                                                            |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| ESLint catches broken imports, unused vars, style drift | Skeleton catches broken links, missing registry rows, stale doc-meta, banned artifacts |
| `eslint --fix` on changed files                         | `skeleton validate changed` on changed docs and skills                                 |
| Pre-commit + CI gate                                    | `--staged` pre-commit + `--base` CI gate                                               |

Skill linters (skillmark, agentlint, skillscheck) answer: _"Is this SKILL.md well-formed?"_ Skeleton answers: _"Does this repo's documentation system hold together?"_

## Quick start

```bash
npm install -D @csark0812/skeleton
npx skeleton init --skills
```

Init writes `.skeleton/`, merges validate scripts into `package.json`, and wires customize hooks for Cursor, Claude Code, and Codex.

Edit `.skeleton/config.yaml` for your repo layout, then verify:

```bash
npx skeleton audit self
```

See [install](docs/developer/install.md) for flags and options.

## What it checks

- **Registry integrity** — `.skeleton/registry.md` topic → canonical file pointers; banner format on registered docs
- **Link audit** — broken refs, skill links, anchors in scanned markdown
- **Skill index** — disk matches taxonomy READMEs in detected skill roots
- **Banned paths** — session artifacts and other files that must not exist
- **Coverage gaps** — markdown outside the scan perimeter (warn-only)
- **Doc meta + stale dates** — owner and `last-reviewed` on index and registry-listed files
- **Shell / JSON syntax** — lightweight checks on changed `.sh` and `.json` files

Code validation (TypeScript, Python, Nx, pytest) stays in your repo. Skeleton handles SSOT-adjacent paths only.

## The `.skeleton/` contract

```
.skeleton/
├── config.yaml      # scan perimeter (required)
├── registry.md      # topic → canonical file (required)
└── customize/       # project-specific skill overrides (optional)
    └── code-review.md
```

Every canonical doc carries a banner:

```markdown
**Source of truth for** Backend API conventions.
```

Register it:

```bash
skeleton register docs/developer/api.md
```

Synced toolbox skills stay pristine. Project overrides live in `.skeleton/customize/<slug>.md` and inject via IDE hooks on skill read — no editing synced `SKILL.md` files.

## Commands

```bash
skeleton init [--skills] [--force-hooks]
skeleton register <path> [--topic=…]
skeleton audit docs|skills|self [--strict] [--paths=a,b]
skeleton validate changed [--staged | --base <ref>] [paths…]
skeleton customize resolve <slug>
```

**Validate changed** routes git diffs to the right audit:

| Path                                         | Action                      |
| -------------------------------------------- | --------------------------- |
| Docs/skills in scan perimeter                | path-scoped audit           |
| `.sh`, `.bash`, `.zsh`                       | shellcheck or `bash -n`     |
| Other `.json`                                | JSONC-tolerant syntax check |
| `.ts`, `.py`, `package.json`, `project.json` | skip                        |

Pre-commit: `skeleton validate changed --staged` (path-scoped, fast).
CI: `skeleton validate changed --base origin/main` (global rules first, then changed files).

## Ecosystem

Skeleton is the shared validation layer in a three-tier setup:

| Repo                 | Role                                               |
| -------------------- | -------------------------------------------------- |
| **skeleton**         | SSOT audit CLI (this repo)                         |
| **toolbox**          | Team skills + public agent preferences             |
| **personal-toolbox** | Private skills + personal preferences              |
| **Consumer apps**    | Call skeleton for SSOT; keep code validation local |

Skeleton never calls Nx or other task runners — consumers call skeleton for doc and skill paths, then handle code paths themselves.

See [tiers](docs/tiers.md).

## Distribution

| Channel                                              | Installs                                                |
| ---------------------------------------------------- | ------------------------------------------------------- |
| `npm install -D @csark0812/skeleton`                 | CLI, schemas, audit engine, hook script                 |
| `npx skills add csark0812/skeleton --skill skeleton` | `/skeleton` agent skill (ops manual, not the installer) |

One command for humans: `npx skeleton init --skills`.

## Docs

- [Install](docs/developer/install.md)
- [Doc system](docs/developer/doc-system.md)
- [Validation](docs/developer/validation.md)
- [Audit rules](docs/developer/audit.md)
- [Customize](docs/developer/customize.md)
- [Authoring conventions](docs/authoring.md)

## Development

Requires Node ≥ 22. Uses Bun for dev and tests. Agent cold-start: [AGENTS.md](AGENTS.md).

```bash
bun install
bun test
bun run typecheck
bun run build
bun run audit:self
```

`validate:changed` is docs/skills only — it skips `.ts` / `.js` / `package.json`. Use `bun test` and `bun run typecheck` for code.

### Publishing 1.1.2 (human)

Keep version `1.1.2` until `npm publish`. Preflight: `bun test && bun run typecheck && bun run build && bun run audit:self`. Then publish and tag when ready (npm is still on `1.1.1` until then).
