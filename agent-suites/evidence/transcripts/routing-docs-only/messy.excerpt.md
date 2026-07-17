# routing: docs-only change — messy

<!-- curated excerpt from live suite report; paths redacted -->

| Field | Value |
| ----- | ----- |
| Arm | messy (`skeleton-messy`) |
| Passed | false |
| Duration | 22235 ms |
| Total tokens | 165278 |
| Tool calls (trace) | 5 |

## Rubric failures

- `mustNotInclude`: forbidden text present: "audit all"

## Judge

_none_

## Tools (first 12)

1. `shell` {"command":"git status && git diff --cached --name-only && ls docs/fixture/","timeout":30000}
2. `shell` {"command":"pwd && ls -la && git -C <worktree>/skeleton-messy-routing-docs-only-change status && git -C <worktree>/skeleton-messy-routing-docs-only-change diff …
3. `shell` {"command":"bun run validate:changed -- docs/fixture/billing-api-legacy.md docs/fixture/billing-api.md docs/fixture/billing-guide-v2.md","workingDirectory":"<wo…
4. `shell` {"command":"ls node_modules 2>/dev/null | head -5; test -f package.json && cat package.json | head -40; ls bun.lock 2>/dev/null; which bun","timeout":30000}
5. `shell` {"command":"bun install && bun run validate:changed -- docs/fixture/billing-api-legacy.md docs/fixture/billing-api.md docs/fixture/billing-guide-v2.md","working…

## Assistant (first turn)

```
I'll check the staged docs under `docs/fixture/` and run the docs validation lane from AGENTS.md.
```

## Assistant (final)

```
Ran `bun run validate:changed -- docs/fixture/billing-api-legacy.md docs/fixture/billing-api.md docs/fixture/billing-guide-v2.md` (docs lane). Doc audit passed (3 files).
```
