# grounding: conflicting docs — messy

<!-- curated excerpt from live suite report; paths redacted -->

| Field | Value |
| ----- | ----- |
| Arm | messy (`skeleton-messy`) |
| Passed | false |
| Duration | 59347 ms |
| Total tokens | 348271 |
| Tool calls (trace) | 24 |

## Rubric failures

- `mustInclude`: expected text not found: "docs/fixture/billing-api.md"
- `mustInclude`: expected text not found: "https://api.example.com/v2/billing/webhook"

## Judge

_none_

## Tools (first 12)

1. `read` {"path":"<worktree>/skeleton-messy-grounding-conflicting-docs/.skeleton/registry.md"}
2. `glob` {"globPattern":"docs/fixture/**/*"}
3. `grep` {"pattern":"Billing|webhook|billing","path":"<worktree>/skeleton-messy-grounding-conflicting-docs/docs/fixture","offset":0}
4. `read` {"path":"<worktree>/skeleton-messy-grounding-conflicting-docs/.skeleton/registry.md"}
5. `read` {"path":"<worktree>/skeleton-messy-grounding-conflicting-docs/docs/fixture/billing-api.md"}
6. `read` {"path":"<worktree>/skeleton-messy-grounding-conflicting-docs/docs/fixture/billing-api-legacy.md"}
7. `read` {"path":"<worktree>/skeleton-messy-grounding-conflicting-docs/docs/fixture/billing-guide-v2.md"}
8. `grep` {"pattern":"Billing|billing|webhook|Canonical","path":"<worktree>/skeleton-messy-grounding-conflicting-docs","glob":"**/*.{md,yaml,yml,json}","offset":0}
9. `glob` {"globPattern":"**/.skeleton/registry.md"}
10. `read` {"path":"<worktree>/skeleton-messy-grounding-conflicting-docs/agent-suites/fixtures/messy/docs/fixture/billing-api.md"}
11. `read` {"path":"<worktree>/skeleton-messy-grounding-conflicting-docs/agent-suites/skeleton-messy/scenarios.json"}
12. `grep` {"pattern":"billing-api|Billing API|api\\.example\\.com","path":"<worktree>/skeleton-messy-grounding-conflicting-docs/.skeleton","offset":0}

## Assistant (first turn)

```
I'll check the registry and the billing fixture docs to see which source wins.
```

## Assistant (final)

```
`.skeleton/registry.md` has an empty Documentation table — **no row for Billing API** — so the registry does not name a canonical file.

The three fixtures under `docs/fixture/` all claim to be SoT and disagree on webhooks; none of them are registered. Per “only the registry decides,” there is **no registry-backed canonical path or webhook** to use. Agents should not treat any of those fixture URLs as authoritative.

CONFLICT_RESOLVED_OK
```
