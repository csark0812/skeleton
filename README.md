# Skeleton

<!-- source-of-truth: Package overview -->

<!-- doc-meta: owner=eng | last-reviewed=2026-10-10 -->

<!-- review-deps: paths=src/cli.ts,src/context.ts,package.json -->

Agent repos get messy fast. Skills get copied around, docs disagree, links go stale, and nobody remembers which file is actually canonical.

Skeleton is an SSOT linter for that layer. Define the contract once; Skeleton checks it locally and in CI. If a canonical doc disappears, SSOT markers drift, a skill index stops matching disk, or a local link breaks, the audit fails before merge.

Think ESLint — for the docs and skills your agents rely on. Primary CLI from `src/cli.ts`: `audit`, `validate`, `route`, `catalog`, `init`, and `build-plugin`. Commands dispatch through that entry file.

Skeleton is **not** a runtime agent harness. It doesn't execute tools, enforce permissions, or manage memory. It checks whether the repo around those systems still holds together.

## Why this matters

Agents can read the repo. They can't reliably infer which of three conflicting docs wins, whether a synced skill should be edited here, or which validation command actually proves a change.

That needs to be explicit — and stay true after the next 50 PRs. Skeleton turns those conventions into checks:

| Code repos                                              | Agent repos                                                                            |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| ESLint catches broken imports, unused vars, style drift | Skeleton catches broken links, bad SSOT markers, stale doc-meta, deny.paths artifacts |
| `eslint --fix` on changed files                         | `skeleton validate changed` on changed docs, skills, and matching document dependencies |
| Pre-commit + CI gate                                    | `--staged` pre-commit + `--base` CI gate                                               |

Skill linters ask: _"Is this SKILL.md well-formed?"_

Skeleton asks the repo-level question: _"Does this whole thing still agree with itself?"_

## Quick start

```bash
npm install -D @csark0812/skeleton
npx skeleton init --skills
```

That writes `skeleton.toml`, adds validation scripts, writes `.pre-commit-config.yaml`, adds a bounded `skeleton context` guide to `AGENTS.md`, and copies the Skeleton skill bundled with the installed package.

Edit `skeleton.toml` for your repo layout, then verify:

```bash
npx skeleton catalog
npx skeleton audit docs
```

Flag details: [install](docs/developer/install.md).

## What it checks

- **SSOT markers** — opt-in `source-of-truth` (comment or visible); dual/malformed forms fail; legacy banners accepted
- **Near-duplicate docs** — shingle overlap + duplicate SSOT summaries (warn / `--strict`)
- **SSOT summary fit** — heuristic overlap between the one-liner and the body (warn / `--strict`)
- **Link audit** — broken refs, skill links, anchors in scanned markdown
- **Skill index** — disk matches taxonomy READMEs in detected skill roots
- **deny.paths** — globs for files that must not exist (often outside `scan.include`)
- **Coverage gaps** — markdown outside the scan perimeter (warn-only)
- **Doc meta + stale dates** — owner and `last-reviewed` on indexes and SSOT-bearing files
- **Review proof** — optional hashes bind a human review to exact document and `review-deps` bytes
- **Dependency routing** — changed repository files automatically pull matching documents into validation
- **Prose policy** (optional plugins) — YAML pattern rules; idle with no plugins
- **Shell / JSON syntax** — lightweight checks on changed `.sh` and `.json` files

Agents skim `.skeleton/catalog.md` (generated, gitignored) before opening full papers.

For a bounded evidence bundle that joins canonical documentation to its declared source owners and nearest focused test, use `skeleton context`. When Skeleton can derive the repository-native focused command, the bundle includes `test-command`. It is read-only and reports whether recorded review evidence still matches:

```bash
skeleton context "billing webhook retry"
skeleton context --path src/billing/delivery.ts
skeleton context "billing webhook URL" --staged
```

When a dependency changed since review, context prints an `action` line requiring the final owning document to be checked against the returned source and every mismatch to be corrected before finishing. When context returns `no-context`, its action asks the agent to inspect nearby code, tests, and docs, repair or create canonical ownership for durable behavior, then repeat the same request until the owner is returned. Read-only tasks report the gap without editing.

Context emits review actions for missing proof (`unreviewed`), dependency changes (`changed-since-review`), and a review date behind a document edit or the configured cadence (`review-required`). Missing proof requires comparing active implementation claims with source; historical alternatives and future aspirations remain qualified intent. A matching hash proves recorded bytes, not semantic agreement.

Each matching paper receives a share of the excerpt budget so one broad owner cannot consume it all. `omitted` and `omitted-source` list excluded papers and declared sources, with an action to narrow the query, increase `--max-chars`, or report the remaining evidence limit. Review status compares the full declared dependency set, including files removed from a glob, even when excerpts are omitted. Complete the relevant review and omission actions before treating the packet as sufficient evidence.

Consumer prevention also requires `review-deps` for active implementation claims and running `validate changed` on source changes. Use a scoped `[reviewCoverage]` policy to reject unowned paths where ownership is required. A doc-only hook or `include = []` leaves those source changes outside the ownership gate. Skeleton does not infer semantic conflicts from prose.

Shared reference files can live in any scanned path. Public repositories can link skills directly to GitHub-hosted references; Skeleton leaves those external links unchanged and does not check their remote reachability.

Skeleton doesn't replace your code gates. Keep TypeScript, Python, Nx, pytest, and the rest in the repo that owns them.

## The contract

Config lives in **`skeleton.toml`** at the repo root (preferred). Optional under `.skeleton/`:

```
skeleton.toml          # scan perimeter, deny.paths, docsLint, …
.skeleton/
├── catalog.md         # generated by `skeleton catalog` (gitignored)
├── review-lock.json   # generated review evidence when reviewProof.mode = "hash"
└── plugins/           # optional consumer audit plugins (.ts + built .mjs)
```

Legacy `.skeleton/config.yaml` still loads when no TOML is present.

Every canonical doc opts into the catalog with a marker:

```markdown
<!-- source-of-truth: Backend API conventions -->
```

Then refresh the agent index:

```bash
skeleton catalog
```

Edit synced skills in the owning toolbox repo. Consumer copies stay read-only.

## Commands

```bash
skeleton init [--skills]
skeleton catalog [--check] [--strict]
skeleton audit docs|skills|self [--strict] [--json] [--paths=a,b] [--fix[=doc-meta|anchors|ssot]] [--dry-run]
skeleton audit docs --paths=docs/a.md --fix=doc-meta --confirm-reviewed
skeleton build-plugin [path] [--check]
skeleton route [path…]
skeleton context <query> | --path <path> [--staged] [--max-chars=N]
skeleton validate changed [--staged | --base <ref>] [paths…]
```

**Validate changed** routes git diffs to the right audit:

| Path                                                                                | Action                                        |
| ----------------------------------------------------------------------------------- | --------------------------------------------- |
| Docs in scan perimeter                                                              | path-scoped audit                             |
| Owned skill bodies (`SKILL.md` trees)                                               | run `audit skills`                            |
| Foreign / lockfile-synced skill bodies                                              | skip → lint in the owning skills/toolbox repo |
| `.sh`, `.bash`, `.zsh`                                                              | shellcheck or `bash -n`                       |
| Other `.json`                                                                       | JSONC-tolerant syntax check                   |
| Any repository file                                                                 | native gates where applicable + audit documents whose `review-deps` path or glob matched |

Pre-commit: `skeleton validate changed --staged` (index bytes, coverage, owning papers).

CI: `skeleton validate changed --base origin/main` (global rules first, then changed files, same coverage fail).

## Ecosystem

| Layer             | Role                                                                                           |
| ----------------- | ---------------------------------------------------------------------------------------------- |
| **Skeleton**      | Defines and checks the SSOT contract                                                           |
| **Shared skills** | Reusable team or public skills. [toolbox](https://github.com/csark0812/toolbox) is one example |
| **Consumer apps** | Pull in the skills, run Skeleton on SSOT paths, and keep their own code gates                  |

Skeleton never calls Nx or another app task runner. Consumer repos keep ownership of test, typecheck, and build.

See [tiers](docs/tiers.md). Related work: [Toolbox](https://github.com/csark0812/toolbox) packages portable process skills, and [Christopher's profile](https://github.com/csark0812) connects the broader builder story.

## Docs

- [Install](docs/developer/install.md)
- [Doc system](docs/developer/doc-system.md)
- [Validation](docs/developer/validation.md)
- [Agent efficacy](docs/developer/efficacy.md)
- [Audit rules](docs/developer/audit.md)
- [Plugins](docs/developer/plugins.md)
- [Authoring conventions](docs/authoring.md)

## Agent efficacy

Four efficiency qualifications ask whether agents complete the same work correctly with at least 35% fewer median tokens when Skeleton is available. Current five-pair OpenAI results exceed that gate in all four tasks, with reductions from 49.1% to 64.0%. One qualification uses a PostPrint-shaped applications monorepo spanning backend, client, generated WebSocket types, and developer documentation; it measured 62.3% lower median tokens. Two additional core tasks measure correctness and reliability without a savings gate, and four package-tradeoff comparisons measure adoption, recovery, and simple-task overhead. The tests check behavior and tokens directly; semantic judges receive only the evidence needed for tasks that require them. These results remain scoped benchmark evidence, not a universal reliability claim.

Method: [Agent efficacy](docs/developer/efficacy.md).

## Development

Requires Bun `1.2.x` and Node ≥ 22. Agent cold-start: [AGENTS.md](AGENTS.md).

```bash
bun install
bun run check
```

`bun run check` = lint + test + typecheck + build + `audit:self`.

`validate:changed` does not replace code tests. It classifies code separately and also audits every scanned document whose `review-deps` declaration matches a changed file. A coverage-candidate path with no owning paper fails on local and CI runs. Owned skill-body edits run the skills suite. `--staged` reads git index bytes.

For code: `bun run test`, `bun run typecheck`, `bun run build`.

`skeleton init` writes `.pre-commit-config.yaml`. Install [pre-commit](https://pre-commit.com/) once (`brew install pre-commit` or `pipx install pre-commit`), then `pre-commit install`.
