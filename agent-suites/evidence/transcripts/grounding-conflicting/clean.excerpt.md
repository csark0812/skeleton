# grounding: conflicting docs — clean

<!-- curated excerpt from live suite report; paths redacted -->

| Field | Value |
| ----- | ----- |
| Arm | clean (`skeleton-clean`) |
| Passed | true |
| Duration | 15434 ms |
| Total tokens | 72279 |
| Tool calls (trace) | 4 |

## Rubric failures

_none_

## Judge

- **pass:** The agent resolved the conflicting billing docs by preferring the registry-registered canonical file
  - The agent explicitly chose the registry-registered canonical billing-api.md over conflicting docs.

## Tools (first 12)

1. `read` {"path":"<worktree>/skeleton-clean-grounding-conflicting-docs/.skeleton/registry.md"}
2. `glob` {"globPattern":"docs/fixture/**/*","targetDirectory":"<worktree>/skeleton-clean-grounding-conflicting-docs"}
3. `read` {"path":"<worktree>/skeleton-clean-grounding-conflicting-docs/docs/fixture/billing-api.md"}
4. `read` {"path":"<worktree>/skeleton-clean-grounding-conflicting-docs/docs/fixture/billing-api-legacy.md"}

## Assistant (first turn)

```
I'll read the registry and the billing docs under `docs/fixture/` to see which file wins.
```

## Assistant (final)

```
Canonical for **Billing API**: `docs/fixture/billing-api.md` (per `.skeleton/registry.md`).

Webhook URL: `https://api.example.com/v2/billing/webhook`

CONFLICT_RESOLVED_OK
```
