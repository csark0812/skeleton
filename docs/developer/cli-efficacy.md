# CLI efficacy

<!-- source-of-truth: intact vs contested host comparison suite -->

<!-- doc-meta: owner=eng | last-reviewed=2026-09-13 -->

<!-- review-deps: paths=package.json,agent-suites/cli-efficacy/**,tests/fixtures/** -->

This repo has one agent-test suite: `cli-efficacy`.
It compares the intact fixture with the contested fixture.

```bash
bun run agent:test
```

That command is `agent-test` from `@post-print/agent-test` 0.3.6.
Pass `--suite`, `--scenario`, or `--host` after `--` when you want a smaller run.

Suite file: [agent-suites/cli-efficacy/scenarios.json](../../agent-suites/cli-efficacy/scenarios.json).
Fixtures: [tests/fixtures](../../tests/fixtures).
