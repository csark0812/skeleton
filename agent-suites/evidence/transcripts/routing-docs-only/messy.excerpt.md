# routing: docs-only change — messy

<!-- curated excerpt from live suite report; paths redacted -->

| Field | Value |
| ----- | ----- |
| Arm | messy (`skeleton-messy`) |
| Passed | false |
| Duration | 23199 ms |
| Total tokens | 147740 |
| Tool calls (trace) | 5 |

## Rubric failures

- `mustNotInclude`: forbidden text present: "audit all"

## Judge

_none_

## Tools (first 12)

1. `shell` {"command":"git status && git diff --cached --name-only && ls docs/fixture/","timeout":30000}
2. `shell` {"command":"pwd && ls -la && git status && git diff --cached --name-only; ls -la docs/ 2>/dev/null; ls -la .skeleton/ 2>/dev/null | head -20","timeout":30000}
3. `shell` {"command":"cd <worktree>/skeleton-messy-routing-docs-only-change && git status && git diff --cached --name-only && ls docs/fixture/","timeout":30000}
4. `shell` {"command":"bun run validate:changed -- docs/fixture/billing-api.md docs/fixture/billing-api-legacy.md docs/fixture/billing-guide-v2.md","workingDirectory":"<wo…
5. `shell` {"command":"bun install && bun run validate:changed -- docs/fixture/billing-api.md docs/fixture/billing-api-legacy.md docs/fixture/billing-guide-v2.md","working…

## Assistant (first turn)

```
Checking the staged docs paths, then running the docs validation lane from AGENTS.md.
```

## Assistant (final)

```
Docs-only lane: ran `bun run validate:changed -- docs/fixture/billing-api.md docs/fixture/billing-api-legacy.md docs/fixture/billing-guide-v2.md` — passed (3 files scanned).
```
