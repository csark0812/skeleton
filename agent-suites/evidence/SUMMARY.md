# Behavioral evidence summary

**Source of truth for** aggregated Skeleton A/B live compares (`skeleton-clean` vs `skeleton-messy`).

<!-- doc-meta: owner=eng | last-reviewed=2026-07-17 -->

**Status: protocol complete (N=10).**

Generated: 2026-07-17T18:40:49.591Z

Runs: `2026-07-17-run-001`, `2026-07-17-run-002`, `2026-07-17-run-003`, `2026-07-17-run-004`, `2026-07-17-run-005`, `2026-07-17-run-006`, `2026-07-17-run-007`, `2026-07-17-run-008`, `2026-07-17-run-009`, `2026-07-17-run-010`

## Gates

| Gate | Result |
| ---- | ------ |
| Grounding McNemar p<0.05 (clean>messy) | PASS |
| Grounding median token Δ (messy−clean) > 0 | PASS |
| Final README claims allowed | yes |

## Per-scenario

| Scenario | Clean pass | Messy pass | McNemar (b/c) | p | Median Δ tokens | Median Δ tools |
| -------- | ---------- | ---------- | ------------- | - | --------------- | -------------- |
| customize: project binding | 10/10 (100%) | 10/10 (100%) | 0/0 | 1.0000 | 15240 | 2 |
| grounding: canonical topic | 10/10 (100%) | 8/10 (80%) | 2/0 | 0.5000 | 386077 | 24 |
| grounding: conflicting docs | 10/10 (100%) | 0/10 (0%) | 10/0 | 0.0020 | 213726 | 18 |
| routing: docs-only change | 10/10 (100%) | 0/10 (0%) | 10/0 | 0.0020 | 6118 | 0 |
| routing: owned skill body | 10/10 (100%) | 10/10 (100%) | 0/0 | 1.0000 | 3096 | 0 |

## Overall deltas (messy − clean)

| Metric | Median | Mean | Bootstrap 95% CI (mean) |
| ------ | ------ | ---- | ----------------------- |
| Total tokens (all scenarios) | 57703 | 142650 | 92818 … 199825 |
| Total tokens (grounding only) | 311833 | 325097 | 260284 … 407269 |
| Tool calls | 4 | 8.7 | — |

McNemar **b** = clean pass / messy fail; **c** = clean fail / messy pass. Positive token Δ means messy used more tokens.

See [transcripts/](transcripts/) for curated clean vs messy excerpts.

