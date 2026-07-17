# grounding: canonical topic — clean

<!-- curated excerpt from live suite report; paths redacted -->

| Field | Value |
| ----- | ----- |
| Arm | clean (`skeleton-clean`) |
| Passed | true |
| Duration | 17049 ms |
| Total tokens | 50257 |
| Tool calls (trace) | 2 |

## Rubric failures

_none_

## Judge

- **pass:** The agent used the registry to select docs/fixture/billing-api.md and quoted the v2 billing webhook, not a legacy or invented URL
  - The agent consulted the registry, selected docs/fixture/billing-api.md as the canonical path, and quoted the v2 billing webhook URL rather than a legacy or invented one.

## Tools (first 12)

1. `read` {"path":"<worktree>/skeleton-clean-grounding-canonical-topic/.skeleton/registry.md"}
2. `grep` {"pattern":"Billing API|billing","path":"<worktree>/skeleton-clean-grounding-canonical-topic","caseInsensitive":true,"offset":0}

## Assistant (first turn)

```
I'll check the registry for the Billing API topic, then open its canonical file.
```

## Assistant (final)

```
CANONICAL_PATH=docs/fixture/billing-api.md
WEBHOOK=https://api.example.com/v2/billing/webhook
```
