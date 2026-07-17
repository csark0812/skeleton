# Agent suites (skeleton behavioral benchmark)

**Source of truth for** live A/B dogfood of the Skeleton SSOT contract via `@post-print/agent-test`.

<!-- doc-meta: owner=eng | last-reviewed=2026-07-17 -->

These suites measure whether a clean Skeleton structure (registry, validation lanes, customize) improves **grounding**, **validation routing**, and **token efficiency** versus a messy control tree — not portable skill conformance (that lives in [toolbox](https://github.com/csark0812/toolbox) `agent-suites/`).

Committed stats and transcript excerpts: [`evidence/`](evidence/). Protocol SSOT: [`refs/llm-harness.md`](../refs/llm-harness.md).

## Layout

```
agent-suites/
  skeleton-clean/     # profile: skeleton — registry in preamble + seeded fixture docs
  skeleton-messy/     # profile: shared — emptied worktree registry + conflicting docs
  fixtures/           # source trees for seed patches
  evidence/           # SUMMARY + curated transcripts (runs/ gitignored)
```

Paired scenario **names** match across clean/messy for `--compare-pairs skeleton-clean:skeleton-messy`.

| Scenario                      | Theme                                               |
| ----------------------------- | --------------------------------------------------- |
| `grounding: canonical topic`  | Registry-first path + webhook citation              |
| `grounding: conflicting docs` | SoT winner via registry                             |
| `routing: docs-only change`   | `validate:changed` lane                             |
| `routing: owned skill body`   | `audit:skills` lane                                 |
| `customize: project binding`  | `.skeleton/customize/` vs editing synced `SKILL.md` |

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

Score from `compare-report.json` after paired live runs. **Protocol target: N=10** independent compares before final README claims (see gates in [`evidence/SUMMARY.md`](evidence/SUMMARY.md)).

| KPI                       | Definition                                    | Success                                                   |
| ------------------------- | --------------------------------------------- | --------------------------------------------------------- |
| Grounding / hallucination | McNemar on paired pass/fail for `grounding:*` | Clean > messy; p < 0.05 at N=10                           |
| Docs routing              | McNemar on `routing: docs-only change`        | Clean > messy                                             |
| Customize / skill routing | Pass rates                                    | Report ties honestly if AGENTS already encodes the rule   |
| Total tokens              | `usage.totalTokens` (messy − clean)           | Median Δ > 0 on grounding; aim ≥20% relative on grounding |
| Tool calls                | `toolCallCount`                               | Clean ≤ messy                                             |
| Duration                  | `durationMs`                                  | Secondary                                                 |

## Dogfood SOP (deposit + aggregate)

1. Export `CURSOR_API_KEY` (CLI does not load `.env`).
2. `bun run agent:test:doctor`
3. Run a compare into a unique out dir:

```bash
OUT="$TMPDIR/skeleton-compare-run-002"
bunx agent-test --suites-dir agent-suites --live \
  --compare-pairs skeleton-clean:skeleton-messy \
  --fail-on=behavior --out-dir "$OUT"
mkdir -p agent-suites/evidence/runs/$(date +%Y-%m-%d)-run-002
cp "$OUT/compare-report.json" agent-suites/evidence/runs/$(date +%Y-%m-%d)-run-002/
# for transcripts: copy suite reports if the CLI wrote them next to compare-report.json
cp "$OUT"/*.suite-report.json agent-suites/evidence/runs/$(date +%Y-%m-%d)-run-002/ 2>/dev/null || true
```

4. Aggregate (and optionally refresh excerpts):

```bash
bun run agent:evidence:aggregate
bun run agent:evidence:excerpt -- --run-dir agent-suites/evidence/runs/<id>
```

5. Update the metric log row in [refs/llm-harness.md](../refs/llm-harness.md).
6. If seeds drift after registry edits, re-check with `git apply --check` on `**/fixtures/seeds/*.patch`.

`evidence/runs/` is gitignored. Commit `SUMMARY.*`, `transcripts/`, and `samples/` after meaningful batches.

Do **not** fold live agent-test into `bun run check`.
