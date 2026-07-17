# routing: docs-only change — clean

<!-- curated excerpt from live suite report; paths redacted -->

| Field | Value |
| ----- | ----- |
| Arm | clean (`skeleton-clean`) |
| Passed | true |
| Duration | 26880 ms |
| Total tokens | 149245 |
| Tool calls (trace) | 5 |

## Rubric failures

_none_

## Judge

- **pass:** The agent chose a docs/SSOT validation lane (validate:changed and/or audit docs/self) for the staged fixture markdown, not an invented gate
  - The agent validated the staged fixture markdown with the docs/SSOT lane validate:changed targeting that file, not an invented gate.

## Tools (first 12)

1. `shell` {"command":"git status && git diff --cached --name-only && ls docs/fixture/","timeout":30000}
2. `shell` {"command":"pwd && git status -sb && git log -1 --oneline && ls -la && find . -path ./node_modules -prune -o -name '*billing*' -print 2>/dev/null | head -20; ls…
3. `shell` {"command":"cd <worktree>/skeleton-clean-routing-docs-only-change && git status && git diff --cached --name-only && ls docs/fixture/","timeout":30000}
4. `shell` {"command":"bun run validate:changed -- docs/fixture/billing-api.md","timeout":30000}
5. `shell` {"command":"bun install && bun run validate:changed -- docs/fixture/billing-api.md","timeout":30000}

## Assistant (first turn)

```
Shell started in the wrong directory — switching to the harness workspace.
```

## Assistant (final)

```
Ran `bun run validate:changed -- docs/fixture/billing-api.md` (docs-only lane). It passed after `bun install`.
```
