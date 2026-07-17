# Skeleton

**Source of truth for** Package overview.

<!-- doc-meta: owner=eng | last-reviewed=2026-07-17 -->

Agent repos get messy fast. Skills get copied around, docs disagree, links go stale, and nobody remembers which file is actually canonical.

Skeleton is an SSOT linter for that layer. You define the contract once; Skeleton checks it locally and in CI.

If a canonical doc disappears, a registry drifts, a skill index stops matching disk, or a generated reference gets edited by hand, the audit fails before merge.

Think ESLint, but for the docs and skills your agents rely on.

Skeleton is **not** a runtime agent harness. It doesn't execute tools, enforce permissions, or manage memory. It checks whether the repo around those systems still holds together.

## Why this matters

Agents can read the repo. They can't reliably infer which of three conflicting docs wins, whether a synced skill should be edited here, or which validation command actually proves a change.

That stuff needs to be explicit. More importantly, it needs to stay true after the next 50 PRs.

Skeleton turns those repo conventions into checks:

| Code repos                                              | Agent repos                                                                            |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| ESLint catches broken imports, unused vars, style drift | Skeleton catches broken links, missing registry rows, stale doc-meta, banned artifacts |
| `eslint --fix` on changed files                         | `skeleton validate changed` on changed docs and skills                                 |
| Pre-commit + CI gate                                    | `--staged` pre-commit + `--base` CI gate                                               |

Skill linters answer: _"Is this SKILL.md well-formed?"_

Skeleton answers the repo-level question: _"Does this whole thing still agree with itself?"_

## What the research says

Research on agent context is still early, but the direction is useful: more context isn't automatically better.

- A [2026 study of repo-level context files](https://doi.org/10.48550/arxiv.2602.11988) tested 438 coding tasks. Human-written files improved resolution by 4% on average; generated files reduced it by 3%. Both increased inference cost by more than 20%. The recommendation was pretty direct: keep instructions minimal and include what the agent can't infer.
- A [2025 METR randomized trial](https://metr.org/blog/2025-07-10-early-2025-ai-experienced-os-dev-study/) found experienced open-source developers took 19% longer with early-2025 AI tools while believing they were faster.

Those studies motivate Skeleton’s constraint (small useful context, clear ownership, verified SSOT). They do **not** measure Skeleton itself.

### Skeleton-specific benchmark (what we measure)

We run a paired live A/B harness (`skeleton-clean` vs `skeleton-messy`) with [`@post-print/agent-test`](https://www.npmjs.com/package/@post-print/agent-test): same prompts, differing registry / conflict structure and context profile. Tasks cover registry grounding, validation-lane choice, and customize ownership.

- Method and significance gates: [refs/llm-harness.md](refs/llm-harness.md) (target **N=10** independent compares; McNemar on pass/fail; token/tool deltas)
- Suite definitions: [agent-suites/README.md](agent-suites/README.md)
- Numbers + transcript excerpts: [agent-suites/evidence/](agent-suites/evidence/)

### What the evidence shows (N=10)

Ten sequential live compares (2026-07-17) are summarized in [SUMMARY.md](agent-suites/evidence/SUMMARY.md). Gates passed: grounding McNemar p < 0.05 (clean > messy) and positive grounding median token Δ (`gates.readmeFinalClaimsAllowed: true`).

| Signal | Clean | Messy | Notes |
| ------ | ----- | ----- | ----- |
| Contested grounding (`conflicting docs`) | **10/10** | **0/10** | McNemar 10/0, p = 0.002 — registry SoT |
| Docs routing | **10/10** | **0/10** | McNemar 10/0, p = 0.002 — messy invents `audit all` |
| Canonical grounding | 10/10 | 8/10 | Pass rate not significant; messy still burns tokens |
| Skill routing + customize | 10/10 | 10/10 | Tied — caller `AGENTS.md` already teaches both |
| Grounding tokens (messy − clean) | — | median **~312k** more | Bootstrap 95% CI on mean excludes 0 |

Side-by-side excerpts (median sequential run): [evidence/transcripts/](agent-suites/evidence/transcripts/) — clean registry hop + correct webhook vs messy conflict thrash and forbidden `audit all`.

### What this does not prove

- Not a general coding-task / SWE-bench success claim
- Live model and prompt variance; fixture tasks only
- Skill/customize may not separate when `AGENTS.md` already encodes the correct rule
- Canonical pass rate alone understates cost — messy often lucks into the answer while spending far more tokens

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

Skeleton doesn't replace your code gates. Keep TypeScript, Python, Nx, pytest, etc. in the repo that owns them.

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

Synced skills stay pristine. Project overrides live in `.skeleton/customize/<slug>.md` and inject when the skill is read. No editing copied `SKILL.md` files.

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

The model is simple:

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

`validate:changed` is docs/config only for path-scoped work — it skips code/config extensions (see table above). Owned skill-body edits need `audit skills`. All-skip, owned skill paths (alone or mixed with docs), and missing paths exit non-zero. For code: `bun test`, `bun run typecheck`, `bun run build`.

Optional: `brew install pre-commit` (or `pipx install pre-commit`), then `pre-commit install` to wire `.pre-commit-config.yaml`.
