# Agent suites

<!-- doc-meta: owner=eng | last-reviewed=2026-09-13 -->

JSON for `@post-print/agent-test` 0.3.6.

```
tests/fixtures/intact/
tests/fixtures/contested/
agent-suites/cli-efficacy/scenarios.json
```

```bash
bun run agent:test
```

That launches the host and scores the suite. `agent-test` already checks the suite file before it starts an agent.

| Scenario | Intact | Contested |
| -------- | ------ | --------- |
| `catalog grounding` | Catalog then v2 webhook | `DUPLICATE_BILLING_SUMMARY` |
| `docs validation lane` | `skeleton validate changed` | `audit all` |
| `owned skill lane` | `skeleton audit skills` | `audit all` |
| `review attestation lane` | `skeleton audit docs --fix=doc-meta --confirm-reviewed` | `audit all` |
| `mixed change lane` | `skeleton validate changed` | `audit all` |
| `orphan policy lane` | `ORPHAN=fail-closed` | `audit all` |
| `route first` | `skeleton route` | `audit all` |
| `owned code paper` | `docs/validation.md` | `audit all` |
| `uncovered code` | `uncovered-changed-path` | `audit all` |
| `json lane` | `skeleton validate changed` | `audit all` |
| `foreign skill lane` | `FOREIGN=skip` | `audit all` |
| `missing path` | `MISSING=missing-path` | `audit all` |
