# grounding: canonical topic — clean

<!-- curated excerpt from live suite report; paths redacted -->

| Field | Value |
| ----- | ----- |
| Arm | clean (`skeleton-clean`) |
| Passed | true |
| Duration | 16762 ms |
| Total tokens | 42079 |
| Tool calls (trace) | 2 |

## Rubric failures

_none_

## Judge

- **pass:** The agent used the registry to select docs/fixture/billing-api.md and quoted the v2 billing webhook, not a legacy or invented URL
  - The agent stated it would use the registry, selected docs/fixture/billing-api.md, and quoted the v2 webhook URL rather than a legacy or invented one.

## Tools (first 12)

1. `read` {"path":"<worktree>/skeleton-clean-grounding-canonical-topic/.skeleton/registry.md"}
2. `grep` {"pattern":"Billing API|billing","path":"<worktree>/skeleton-clean-grounding-canonical-topic","glob":"**/*.{md,yaml,yml}","offset":0}

## Assistant (first turn)

```
I'll read the registry first, then open the canonical file for Billing API.
```

## Assistant (final)

```
CANONICAL_PATH=docs/fixture/billing-api.md
WEBHOOK=https://api.example.com/v2/billing/webhook
```
