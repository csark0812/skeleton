# routing: docs-only change — clean

<!-- curated excerpt from live suite report; paths redacted -->

| Field | Value |
| ----- | ----- |
| Arm | clean (`skeleton-clean`) |
| Passed | true |
| Duration | 23970 ms |
| Total tokens | 160782 |
| Tool calls (trace) | 5 |

## Rubric failures

_none_

## Judge

- **pass:** The agent chose a docs/SSOT validation lane (validate:changed and/or audit docs/self) for the staged fixture markdown, not an invented gate
  - The agent ran the docs-lane validate:changed command on the staged fixture markdown rather than inventing a different gate.

## Tools (first 12)

1. `shell` {"command":"git status && git diff --cached --name-only","timeout":30000}
2. `shell` {"command":"pwd && ls -la docs/fixture/ 2>/dev/null; git status --short; ls docs/fixture/billing-api.md 2>/dev/null; git log -1 --oneline","timeout":30000}
3. `shell` {"command":"cd <worktree>/skeleton-clean-routing-docs-only-change && git status && git diff --cached --name-only && ls -la docs/fixture/ 2>/dev/null || ls -la d…
4. `shell` {"command":"bun run validate:changed -- docs/fixture/billing-api.md","workingDirectory":"<worktree>/skeleton-clean-routing-docs-only-change","timeout":30000}
5. `shell` {"command":"bun install && bun run validate:changed -- docs/fixture/billing-api.md","workingDirectory":"<worktree>/skeleton-clean-routing-docs-only-change","tim…

## Assistant (first turn)

```
I'll check the staged docs path, then run the docs-lane `validate:changed` command from AGENTS.md.
```

## Assistant (final)

```
Ran `bun run validate:changed -- docs/fixture/billing-api.md` (docs lane). Doc audit passed.
```
