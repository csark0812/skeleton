# Agent suites (skeleton behavioral benchmark)

**Source of truth for** direct-agent A/B dogfood of the Skeleton SSOT contract via `@post-print/agent-test`.

<!-- doc-meta: owner=eng | last-reviewed=2026-07-17 -->

These suites measure whether a clean Skeleton structure (catalog, validation lanes, customize) improves **grounding**, **validation routing**, and **token efficiency** versus a messy control tree — not portable skill conformance (that lives in [toolbox](https://github.com/csark0812/toolbox) `agent-suites/`).

Committed stats and transcript excerpts: [`evidence/`](evidence/). Protocol SSOT: [`refs/llm-harness.md`](../refs/llm-harness.md).

## Layout

```
agent-suites/
  skeleton-clean/     # profile: skeleton — catalog routing in preamble + canonical fixture doc
  skeleton-messy/     # profile: shared — no catalog routing + conflicting fixture docs
  fixtures/           # source trees for seed patches
  evidence/           # SUMMARY + curated transcripts (runs/ gitignored)
```

Paired scenario **names** match across clean/messy for `--compare-pairs skeleton-clean:skeleton-messy`.

| Scenario                      | Theme                                               |
| ----------------------------- | --------------------------------------------------- |
| `grounding: canonical topic`  | Catalog-first path + webhook citation               |
| `grounding: conflicting docs` | SoT winner via the generated catalog                |
| `routing: docs-only change`   | `validate:changed` lane                             |
| `routing: owned skill body`   | `audit:skills` lane                                 |
| `customize: project binding`  | `.skeleton/customize/` vs editing synced `SKILL.md` |

## Commands

Requires **Node ≥ 22**, a direct-only `@post-print/agent-test` release, and an exported provider credential (see [`.env.example`](../.env.example)). Cursor is the suite default and requires `CURSOR_API_KEY`. Claude runs use `--host claude` and require `ANTHROPIC_API_KEY`; the default judge still requires `CURSOR_API_KEY` unless `--no-judge` is set. Every execution launches a real provider agent and can incur usage.

```bash
bun run agent:test:doctor
bun run agent:test:validate
bun run agent:test:direct:compare
```

Optional debug (staging under `$TMPDIR` by default):

```bash
bun run agent:test:direct:debug -- --suite skeleton-clean
bun run agent:test:direct:compare -- --debug --out-dir "$TMPDIR/skeleton-compare"
```

Direct execution is the primary signal. Both suites default to `host: "cursor"`; use `--host claude` to run the same scenarios with Claude. `agent:test:validate` is the offline configuration and path check. Do not add direct execution to deterministic CI without explicit credentials, provider-usage approval, and a budget.

**Note:** Direct runs load **preamble context from the caller checkout** (`AGENTS.md`, profile sources). Seed patches change the **worktree disk** the agent tools see. Clean vs messy therefore differs by `profile` (`skeleton` vs `shared`) plus the seeded fixture's SSOT shape. Skill seeds use worktree path `fixture-skills/` (not `.claude/skills/`) because root `.claude/` is gitignored and harness seeding must `git add` the files.

## Success criteria (KPIs)

Score from `compare-report.json` after paired direct runs. **Protocol target: N=10** independent compares before final README claims (see gates in [`evidence/SUMMARY.md`](evidence/SUMMARY.md)).

| KPI                       | Definition                                    | Success                                                   |
| ------------------------- | --------------------------------------------- | --------------------------------------------------------- |
| Grounding / hallucination | McNemar on paired pass/fail for `grounding:*` | Clean > messy; p < 0.05 at N=10                           |
| Docs routing              | McNemar on `routing: docs-only change`        | Clean > messy                                             |
| Customize / skill routing | Pass rates                                    | Report ties honestly if AGENTS already encodes the rule   |
| Total tokens              | `usage.totalTokens` (messy − clean)           | Median Δ > 0 on grounding; aim ≥20% relative on grounding |
| Tool calls                | `toolCallCount`                               | Clean ≤ messy                                             |
| Duration                  | `durationMs`                                  | Secondary                                                 |

## Dogfood SOP (deposit + aggregate)

1. Export `CURSOR_API_KEY` for the default Cursor host, or export `ANTHROPIC_API_KEY` and pass `--host claude`. The CLI does not load `.env`; the default judge still needs `CURSOR_API_KEY` unless disabled.
2. `bun run agent:test:doctor`
3. Run a compare into a unique out dir:

```bash
OUT="$TMPDIR/skeleton-compare-run-002"
bunx agent-test --suites-dir agent-suites \
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
6. If seeds drift after catalog or fixture changes, rerun `bunx agent-test --validate-seeds --suites-dir agent-suites`.

`evidence/runs/` is gitignored. Commit `SUMMARY.*`, `transcripts/`, and `samples/` after meaningful batches.

Do **not** fold direct agent execution into `bun run check`.
