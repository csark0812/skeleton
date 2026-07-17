# Skeleton

**Source of truth for** Package overview.

<!-- doc-meta: owner=eng | last-reviewed=2026-07-17 -->

Agent repos get messy fast. Skills get copied around, docs disagree, links go stale, and nobody remembers which file is actually canonical.

Skeleton is an SSOT linter for that layer. Define the contract once; Skeleton checks it locally and in CI. If a canonical doc disappears, a registry drifts, a skill index stops matching disk, or a generated reference gets edited by hand, the audit fails before merge.

Think ESLint — for the docs and skills your agents rely on.

Skeleton is **not** a runtime agent harness. It doesn't execute tools, enforce permissions, or manage memory. It checks whether the repo around those systems still holds together.

## Why this matters

Agents can read the repo. They can't reliably infer which of three conflicting docs wins, whether a synced skill should be edited here, or which validation command actually proves a change.

That needs to be explicit — and stay true after the next 50 PRs. Skeleton turns those conventions into checks:

| Code repos                                              | Agent repos                                                                            |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| ESLint catches broken imports, unused vars, style drift | Skeleton catches broken links, missing registry rows, stale doc-meta, banned artifacts |
| `eslint --fix` on changed files                         | `skeleton validate changed` on changed docs and skills                                 |
| Pre-commit + CI gate                                    | `--staged` pre-commit + `--base` CI gate                                               |

Skill linters ask: _"Is this SKILL.md well-formed?"_

Skeleton asks the repo-level question: _"Does this whole thing still agree with itself?"_

## Why a clean SSOT helps agents

### Question

Does an intact Skeleton contract change agent behavior — grounding on the right doc, picking the right validation lane, and how much work it takes to get there?

### What we did

We ran a paired live A/B harness with [`@post-print/agent-test`](https://www.npmjs.com/package/@post-print/agent-test): `skeleton-clean` vs `skeleton-messy`. Same prompts and scenario set; the only intentional difference was registry / conflict structure and context profile.

Scenarios covered contested grounding (conflicting docs), docs-only validation routing, canonical grounding, owned-skill routing, and customize ownership. Protocol: **N=10** sequential paired compares on 2026-07-17; McNemar on paired pass/fail; median token deltas with a bootstrap CI on the mean.

Full method: [refs/llm-harness.md](refs/llm-harness.md). Suites: [agent-suites/README.md](agent-suites/README.md). Aggregated numbers: [SUMMARY.md](agent-suites/evidence/SUMMARY.md). Side-by-side excerpts: [evidence/transcripts/](agent-suites/evidence/transcripts/).

### What improved

On tasks that depend on an intact SSOT, the clean fixture was both more accurate and cheaper:

- **Contested grounding** — In every paired run, clean settled on the registry canonical; messy never did (McNemar p = 0.002). Clean hops the registry; messy thrashes across conflicting docs.
- **Docs routing** — Clean consistently chose the correct audit lane; messy invented a non-existent `audit all` path (McNemar p = 0.002).
- **Token cost** — Across grounding tasks, messy used a median **~312k** more tokens than clean (bootstrap 95% CI on the mean excludes 0). Pass rate alone understates the gap: messy can still luck into an answer while spending far more.

Two scenarios did **not** show a clean accuracy win:

- **Canonical grounding** — Pass rates were close; the difference was not significant. Cost still favored clean.
- **Skill routing + customize** — Tied. The caller `AGENTS.md` already encodes both rules, so the fixtures did not separate on those prompts.

### Limits

Fixture A/B on Skeleton’s own contract (live model + prompt variance) — not a general coding-task or SWE-bench claim. Skill/customize may not separate when the entry doc already teaches the correct rule.

### Industry context

Not a Skeleton measurement — broader context research points the same direction: more context isn’t free. A [2026 study of repo-level context files](https://doi.org/10.48550/arxiv.2602.11988) (438 tasks) found human-written files helped ~4% on average, generated files hurt ~3%, and both raised inference cost >20%. A [2025 METR trial](https://metr.org/blog/2025-07-10-early-2025-ai-experienced-os-dev-study/) found experienced OSS developers took 19% longer with early-2025 AI tools while believing they were faster. Those papers motivate small instructions and explicit ownership; they do **not** measure this tool.

## Quick start

```bash
npm install -D @csark0812/skeleton
npx skeleton init --skills
```

That writes `.skeleton/`, adds the validation scripts, and wires customize hooks for Cursor, Claude Code, and Codex.

Edit `.skeleton/config.yaml` for your repo layout, then verify:

```bash
npx skeleton audit self
```

Flag details: [install](docs/developer/install.md).

## What it checks

- **Registry integrity** — `.skeleton/registry.md` topic → canonical file pointers; banner format on registered docs
- **Link audit** — broken refs, skill links, anchors in scanned markdown
- **Skill index** — disk matches taxonomy READMEs in detected skill roots
- **Banned paths** — session artifacts and other files that must not exist
- **Coverage gaps** — markdown outside the scan perimeter (warn-only)
- **Doc meta + stale dates** — owner and `last-reviewed` on index and registry-listed files
- **Prose policy** (optional plugins) — YAML pattern rules; idle with no plugins
- **Shell / JSON syntax** — lightweight checks on changed `.sh` and `.json` files

Skeleton doesn't replace your code gates. Keep TypeScript, Python, Nx, pytest, and the rest in the repo that owns them.

## The `.skeleton/` contract

```
.skeleton/
├── config.yaml      # scan perimeter (required)
├── registry.md      # topic → canonical file (required)
├── plugins/         # optional consumer audit plugins (.ts + built .mjs)
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

Synced skills stay pristine. Project overrides live in `.skeleton/customize/<slug>.md` and inject when the skill is read — no editing copied `SKILL.md` files.

## Commands

```bash
skeleton init [--skills] [--force-hooks]
skeleton register <path> [--topic=…]
skeleton audit docs|skills|self [--strict] [--paths=a,b] [--fix[=doc-meta|anchors]] [--dry-run]
skeleton build-plugin [path] [--check]
skeleton validate changed [--staged | --base <ref>] [paths…]
skeleton references sync|check
skeleton customize resolve <slug>
```

**Validate changed** routes git diffs to the right audit:

| Path                                                                                | Action                                        |
| ----------------------------------------------------------------------------------- | --------------------------------------------- |
| Docs in scan perimeter                                                              | path-scoped audit                             |
| Owned skill bodies (`SKILL.md` trees)                                               | exit 1 → run `audit skills`                   |
| Foreign / lockfile-synced skill bodies                                              | skip → lint in the owning skills/toolbox repo |
| `.sh`, `.bash`, `.zsh`                                                              | shellcheck or `bash -n`                       |
| Other `.json`                                                                       | JSONC-tolerant syntax check                   |
| `.ts`, `.tsx`, `.js`, `.jsx`, `.mjs`, `.cjs`, `.py`, `package.json`, `project.json` | skip (exits 1 if all skip)                    |

Pre-commit: `skeleton validate changed --staged` (path-scoped, fast).

CI: `skeleton validate changed --base origin/main` (global rules first, then changed files).

## Ecosystem

| Layer             | Role                                                                                           |
| ----------------- | ---------------------------------------------------------------------------------------------- |
| **Skeleton**      | Defines and checks the SSOT contract                                                           |
| **Shared skills** | Reusable team or public skills. [toolbox](https://github.com/csark0812/toolbox) is one example |
| **Consumer apps** | Pull in the skills, run Skeleton on SSOT paths, and keep their own code gates                  |

Skeleton never calls Nx or another app task runner. Consumer repos keep ownership of test, typecheck, and build.

See [tiers](docs/tiers.md).

## Docs

- [Install](docs/developer/install.md)
- [Doc system](docs/developer/doc-system.md)
- [Validation](docs/developer/validation.md)
- [Audit rules](docs/developer/audit.md)
- [Plugins](docs/developer/plugins.md)
- [Customize](docs/developer/customize.md)
- [Authoring conventions](docs/authoring.md)

## Development

Requires Bun `1.2.x` and Node ≥ 22. Agent cold-start: [AGENTS.md](AGENTS.md).

```bash
bun install
bun run check
```

`bun run check` = lint + test + typecheck + build + `audit:self`.

`validate:changed` is docs/config only for path-scoped work — it skips code/config extensions (see table above). Owned skill-body edits need `audit skills`. All-skip, owned skill paths (alone or mixed with docs), and missing paths exit non-zero.

For code: `bun test`, `bun run typecheck`, `bun run build`.

Optional: `brew install pre-commit` (or `pipx install pre-commit`), then `pre-commit install` to wire `.pre-commit-config.yaml`.
