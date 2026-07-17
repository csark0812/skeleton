# Agent suites (skeleton behavioral benchmark)

**Source of truth for** live A/B dogfood of the Skeleton SSOT contract via `@post-print/agent-test`.

<!-- doc-meta: owner=eng | last-reviewed=2026-07-17 -->

These suites measure whether a clean Skeleton structure (registry, validation lanes, customize) improves **grounding**, **validation routing**, and **token efficiency** versus a messy control tree — not portable skill conformance (that lives in [toolbox](https://github.com/csark0812/toolbox) `agent-suites/`).

## Layout

```
agent-suites/
  skeleton-clean/     # profile: skeleton — registry in preamble + seeded fixture docs
  skeleton-messy/     # profile: shared — emptied worktree registry + conflicting docs
  fixtures/
    clean/            # readable source trees used to build seed patches
    messy/
```

Paired scenario **names** match across clean/messy for `--compare-pairs skeleton-clean:skeleton-messy`.

| Scenario | Theme |
| -------- | ----- |
| `grounding: canonical topic` | Registry-first path + webhook citation |
| `grounding: conflicting docs` | SoT winner via registry |
| `routing: docs-only change` | `validate:changed` lane |
| `routing: owned skill body` | `audit:skills` lane |
| `customize: project binding` | `.skeleton/customize/` vs editing synced `SKILL.md` |

## Commands

Requires **Node ≥ 22**, exported `CURSOR_API_KEY` (see [`.env.example`](../.env.example)), and `@post-print/agent-test` ≥ 0.2.7.

```bash
bun run agent:test:doctor
bun run agent:test:validate
bun run agent:test:live:compare
```

Optional debug (staging under `$TMPDIR` by default):

```bash
bun run agent:test:live:debug -- --suite skeleton-clean
bun run agent:test:live:compare -- --debug --out-dir "$TMPDIR/skeleton-compare"
```

Live is the primary signal. Suites default to `host: "replay"` so accidental non-live runs are not CI gates — always pass `--live` (the npm scripts do). Golden replay traces are deferred until rubrics stabilize.

**Note:** Live worktrees load **preamble context from the caller checkout** (`AGENTS.md`, profile sources). Seed patches change the **worktree disk** the agent tools see. Clean vs messy therefore differs by `profile` (`skeleton` vs `shared`) plus seeded fixture/registry state. Skill seeds use worktree path `fixture-skills/` (not `.claude/skills/`) because root `.claude/` is gitignored and harness seeding must `git add` the files.

## Success criteria (KPIs)

Score from `compare-report.json` / `.md` / `.html` after paired live runs. Prefer N≥10 batches before claiming deltas.

| KPI | Definition | Success |
| --- | --- | --- |
| Grounding / hallucination | `(rubric_miss + grounding judge fails) / runs` | Lower on clean |
| Routing accuracy | `mustRun` / routing judge pass rate | Higher on clean |
| Customize ownership | Overlay created; synced skill not rewritten | Higher pass on clean |
| Total tokens | `usage.totalTokens` on passed pairs | Clean ≤ messy (target ≥20% lower median) |
| Tool calls | `toolCallCount` | Clean ≤ messy |
| Registry-first hop | `mustReadPath` / first Read hits registry | Higher on clean |
| Duration | `durationMs` | Secondary; report only |

## Dogfood SOP

1. Export `CURSOR_API_KEY` (CLI does not load `.env`).
2. `bun run agent:test:doctor`
3. `bun run agent:test:live:compare`
4. Inspect `$TMPDIR/skeleton-compare/compare-report.md` (and HTML).
5. Log a short metrics row in [refs/llm-harness.md](../refs/llm-harness.md) (date, N, pass deltas, token p50).
6. If seeds drift after registry edits, re-check with `git apply --check` on `**/fixtures/seeds/*.patch`.

Do **not** fold live agent-test into `bun run check`.
