# Behavioral evidence summary

**Source of truth for** aggregated Skeleton A/B live compares (`skeleton-clean` vs `skeleton-messy`).

<!-- doc-meta: owner=eng | last-reviewed=2026-07-17 -->

**Status: preliminary (N=1 / target 10).** Do not treat McNemar p-values as final README claims until N=10.

Generated: 2026-07-17T17:40:19.378Z

Runs: `2026-07-17-run-001`

## Gates

| Gate | Result |
| ---- | ------ |
| Grounding McNemar p<0.05 (clean>messy) | FAIL / n/a |
| Grounding median token Δ (messy−clean) > 0 | PASS |
| Final README claims allowed | no |

## Per-scenario

| Scenario | Clean pass | Messy pass | McNemar (b/c) | p | Median Δ tokens | Median Δ tools |
| -------- | ---------- | ---------- | ------------- | - | --------------- | -------------- |
| customize: project binding | 1/1 (100%) | 1/1 (100%) | 0/0 | 1.0000 | 74923 | 6 |
| grounding: canonical topic | 1/1 (100%) | 0/1 (0%) | 1/0 | 1.0000 | 442695 | 26 |
| grounding: conflicting docs | 1/1 (100%) | 0/1 (0%) | 1/0 | 1.0000 | 314719 | 21 |
| routing: docs-only change | 1/1 (100%) | 0/1 (0%) | 1/0 | 1.0000 | -1505 | 0 |
| routing: owned skill body | 1/1 (100%) | 1/1 (100%) | 0/0 | 1.0000 | -15316 | 4 |

## Overall deltas (messy − clean)

| Metric | Median | Mean | Bootstrap 95% CI (mean) |
| ------ | ------ | ---- | ----------------------- |
| Total tokens (all scenarios) | 74923 | 163103 | 8256 … 328260 |
| Total tokens (grounding only) | 378707 | 378707 | 314719 … 442695 |
| Tool calls | 6 | 11.4 | — |

McNemar **b** = clean pass / messy fail; **c** = clean fail / messy pass. Positive token Δ means messy used more tokens.

See [transcripts/](transcripts/) for curated clean vs messy excerpts.

