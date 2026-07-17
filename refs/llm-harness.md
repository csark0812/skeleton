# LLM harness (behavioral benchmark)

**Source of truth for** Skeleton-specific agent-behavior evaluation (token efficiency, grounding, validation routing).

<!-- doc-meta: owner=eng | last-reviewed=2026-07-17 -->

Skeleton’s deterministic suite (`audit` / `validate` / Bun tests) proves the repo still agrees with itself. This harness asks whether agents **perform better** with that contract.

Implementation: [`agent-suites/`](../agent-suites/) via [`@post-print/agent-test`](https://www.npmjs.com/package/@post-print/agent-test) ≥ 0.2.7 (usage capture, `profile: "skeleton"`, `--compare-pairs`, `mustReadPath`).

## Design

- **Paired A/B:** `skeleton-clean` vs `skeleton-messy` (identical scenario names)
- **Primary signal:** live Cursor (`bun run agent:test:live:compare`)
- **Not in `bun run check`:** keeps deterministic CI fast

See [agent-suites/README.md](../agent-suites/README.md) for layout, commands, and KPIs.

## Metric log

Record dogfood batches here (expand after each run):

| Date | N (pairs) | Clean pass % | Messy pass % | Token p50 clean | Token p50 messy | Notes |
| ---- | --------- | ------------ | ------------ | --------------- | --------------- | ----- |
| — | — | — | — | — | — | No baseline yet |

## Related

- Product caveat: [README.md](../README.md) (“needs a Skeleton-specific benchmark”)
- Validation lanes gold: [AGENTS.md](../AGENTS.md), [docs/developer/validation.md](../docs/developer/validation.md)
