# grounding: conflicting docs — clean

<!-- curated excerpt from live suite report; paths redacted -->

| Field | Value |
| ----- | ----- |
| Arm | clean (`skeleton-clean`) |
| Passed | true |
| Duration | 13263 ms |
| Total tokens | 33552 |
| Tool calls (trace) | 3 |

## Rubric failures

_none_

## Judge

- **pass:** The agent resolved the conflicting billing docs by preferring the registry-registered canonical file
  - The agent explicitly selected the registry-registered file as the canonical billing source, resolving the conflict per the criterion.

## Tools (first 12)

1. `read` {"path":"<worktree>/skeleton-clean-grounding-conflicting-docs/.skeleton/registry.md"}
2. `glob` {"globPattern":"docs/fixture/**/*"}
3. `grep` {"pattern":"Billing|billing|webhook","path":"<worktree>/skeleton-clean-grounding-conflicting-docs","offset":0}

## Assistant (first turn)

```
I'll check the registry and the billing fixture docs to see which file wins and which webhook URL to use.
```

## Assistant (final)

```
Canonical for **Billing API**: `docs/fixture/billing-api.md` (per `.skeleton/registry.md`).

Webhook agents should use: `https://api.example.com/v2/billing/webhook`

CONFLICT_RESOLVED_OK
```
