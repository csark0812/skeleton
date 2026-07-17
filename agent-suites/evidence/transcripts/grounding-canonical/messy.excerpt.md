# grounding: canonical topic — messy

<!-- curated excerpt from live suite report; paths redacted -->

| Field | Value |
| ----- | ----- |
| Arm | messy (`skeleton-messy`) |
| Passed | true |
| Duration | 58907 ms |
| Total tokens | 390065 |
| Tool calls (trace) | 20 |

## Rubric failures

_none_

## Judge

- **pass:** The agent selected the true canonical billing path and v2 webhook; inventing or picking a conflicting messy URL is a fail
  - The transcript explicitly records the canonical billing fixture path and the v2 webhook URL with no conflicting or invented messy URL.

## Tools (first 12)

1. `read` {"path":"<worktree>/skeleton-messy-grounding-canonical-topic/.skeleton/registry.md"}
2. `read` {"path":"<worktree>/skeleton-messy-grounding-canonical-topic/.skeleton/registry.md"}
3. `grep` {"pattern":"Billing","path":"<worktree>/skeleton-messy-grounding-canonical-topic","caseInsensitive":true,"offset":0}
4. `grep` {"pattern":"Billing API|billing-api|Canonical file|registry","path":"<worktree>/skeleton-messy-grounding-canonical-topic/.skeleton","offset":0}
5. `read` {"path":"<worktree>/skeleton-messy-grounding-canonical-topic/docs/fixture/billing-api.md"}
6. `glob` {"globPattern":"**/*registry*","targetDirectory":"<worktree>/skeleton-messy-grounding-canonical-topic"}
7. `read` {"path":"<worktree>/skeleton-messy-grounding-canonical-topic/agent-suites/fixtures/messy/docs/fixture/billing-api.md"}
8. `read` {"path":"<worktree>/skeleton-messy-grounding-canonical-topic/docs/fixture/billing-api-legacy.md"}
9. `read` {"path":"<worktree>/skeleton-messy-grounding-canonical-topic/docs/fixture/billing-guide-v2.md"}
10. `read` {"path":"<worktree>/skeleton-messy-grounding-canonical-topic/agent-suites/skeleton-messy/fixtures/seeds/grounding.patch"}
11. `grep` {"pattern":"v2/billing/webhook|Billing API|canonical","path":"<worktree>/skeleton-messy-grounding-canonical-topic","glob":"**/*.{md,yaml,yml,json,patch}","offse…
12. `shell` {"command":"ls -la .skeleton/ && wc -l .skeleton/registry.md && xxd .skeleton/registry.md | head -50; git log -3 --oneline; git status; ls docs/fixture/","timeo…

## Assistant (first turn)

```
I'll read the registry first, then open the canonical Billing API file.
```

## Assistant (final)

```
CANONICAL_PATH=docs/fixture/billing-api.md
WEBHOOK=https://api.example.com/v2/billing/webhook
```
