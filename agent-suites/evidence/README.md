# Behavioral evidence

**Source of truth for** committed artifacts from the Skeleton live A/B benchmark.

<!-- doc-meta: owner=eng | last-reviewed=2026-07-17 -->

## What is committed

| Path                                                                       | Purpose                                                  |
| -------------------------------------------------------------------------- | -------------------------------------------------------- |
| [`SUMMARY.md`](SUMMARY.md) / [`SUMMARY.json`](SUMMARY.json)                | Aggregated stats across deposited runs                   |
| [`transcripts/`](transcripts/)                                             | Curated clean vs messy excerpts (not full debug bundles) |
| [`samples/compare-report.sample.json`](samples/compare-report.sample.json) | Format example of one compare report                     |

## What is gitignored

`runs/` — raw per-run `compare-report.json` (+ optional suite reports). Deposit locally, then aggregate:

```bash
# after each live compare:
mkdir -p agent-suites/evidence/runs/$(date +%Y-%m-%d)-run-NNN
cp "$TMPDIR/skeleton-compare-run-NNN/compare-report.json" \
  agent-suites/evidence/runs/$(date +%Y-%m-%d)-run-NNN/

bun run agent:evidence:aggregate
```

## Privacy

Do not commit API keys, `.env`, or full debug bundles. Excerpts redact absolute worktree paths to `<worktree>/…`.

## Protocol

See [refs/llm-harness.md](../../refs/llm-harness.md) and [agent-suites/README.md](../README.md). Protocol target **N=10** independent sequential compares. The 2026-07-17 batch met both gates (`readmeFinalClaimsAllowed: true`); curated excerpts are from median run `2026-07-17-run-006`.
