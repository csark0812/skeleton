# LLM harness (behavioral benchmark)

**Source of truth for** Skeleton-specific agent-behavior evaluation (token efficiency, grounding, validation routing).

<!-- doc-meta: owner=eng | last-reviewed=2026-07-17 -->

Skeleton’s deterministic suite (`audit` / `validate` / Bun tests) proves the repo still agrees with itself. This harness asks whether agents **perform better** with that contract.

Implementation: [`agent-suites/`](../agent-suites/) via [`@post-print/agent-test`](https://www.npmjs.com/package/@post-print/agent-test) ≥ 0.2.7. Committed evidence: [`agent-suites/evidence/`](../agent-suites/evidence/).

## Design

- **Paired A/B:** `skeleton-clean` vs `skeleton-messy` (identical scenario names)
- **Primary signal:** live Cursor (`bun run agent:test:live:compare`)
- **Not in `bun run check`:** keeps deterministic CI fast

## Protocol (N=10)

1. Fix git SHA / model defaults for the batch (log in notes if non-default).
2. For `i` in 1…10:

```bash
set -a && source .env && set +a
OUT="$TMPDIR/skeleton-compare-run-$(printf '%03d' "$i")"
bunx agent-test --suites-dir agent-suites --live \
  --compare-pairs skeleton-clean:skeleton-messy \
  --fail-on=behavior --out-dir "$OUT"
mkdir -p "agent-suites/evidence/runs/$(date +%Y-%m-%d)-run-$(printf '%03d' "$i")"
cp "$OUT/compare-report.json" \
  "agent-suites/evidence/runs/$(date +%Y-%m-%d)-run-$(printf '%03d' "$i")/"
# optional (for excerpts): also copy *.suite-report.json from $OUT if present
```

3. Aggregate and refresh excerpts from a representative run:

```bash
bun run agent:evidence:aggregate
bun run agent:evidence:excerpt -- --run-dir agent-suites/evidence/runs/<id>
```

### Endpoints and significance gates

| Endpoint          | Unit                                              | Test                                                    |
| ----------------- | ------------------------------------------------- | ------------------------------------------------------- |
| Grounding pass    | Paired binary × N for each `grounding:*` scenario | McNemar (b=clean✓/messy✗, c=reverse); exact two-sided p |
| Docs-routing pass | `routing: docs-only change`                       | McNemar                                                 |
| Token delta       | `totalTokens` (messy − clean)                     | Median Δ; bootstrap 95% CI on mean                      |
| Tool delta        | `toolCallCount` (messy − clean)                   | Median / mean; secondary                                |

**Gate before final README claims** (`SUMMARY.json` → `gates.readmeFinalClaimsAllowed`):

- N ≥ 10 deposited runs
- At least one grounding scenario with McNemar p < 0.05 and b > c
- Grounding median token Δ > 0 (messy uses more tokens)

Until then, README and SUMMARY stay labeled **preliminary**.

## Metric log

| Date       | N   | Clean grounding | Messy grounding | Median Δ tokens (grounding) | Notes                                                                                                                                 |
| ---------- | --- | --------------- | --------------- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-07-17 | 10  | 20/20           | 8/20            | ~312k                       | Sequential batch; conflicting docs 10/0 (p=0.002); docs routing 10/0 (`audit all`); skill+customize tied; gates → final README claims |
| 2026-07-17 | 1   | 2/2             | 0/2             | ~379k                       | Superseded by N=10 row (early deposit)                                                                                                |

See [`agent-suites/evidence/SUMMARY.md`](../agent-suites/evidence/SUMMARY.md) for full tables.

## Related

- Consumer SOP: [agent-suites/README.md](../agent-suites/README.md)
- Product narrative: [README.md](../README.md)
- Validation lanes gold: [AGENTS.md](../AGENTS.md), [docs/developer/validation.md](../docs/developer/validation.md)
