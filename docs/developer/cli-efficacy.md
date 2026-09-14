# CLI efficacy

<!-- source-of-truth: cli-lanes vs audit-all host comparison suite -->

<!-- doc-meta: owner=eng | last-reviewed=2026-09-13 -->

<!-- review-deps: paths=package.json,agent-suites/cli-efficacy/**,tests/fixtures/** -->

This repo has one agent-test suite: `cli-efficacy`.
It compares `tests/fixtures/cli-lanes` with `tests/fixtures/audit-all`.

```bash
bun run agent:test
```

That command is `agent-test` from `@post-print/agent-test` 0.3.8.
Pass `--suite`, `--scenario`, or `--host` after `--` when you want a smaller run.

## What the trees are

`cli-lanes` publishes this repo's real CLI lanes: `skeleton route`, `skeleton validate changed`, `skeleton audit skills`, and the attest command.

`audit-all` publishes one fake command for every lane.

The prompts are the same. The published command table is the only intended difference.

## How the score shows CLI improvement

The suite does not execute the CLI. Both trees forbid Shell and writes.

The score is the command the agent names.

On `cli-lanes`, a pass means the agent named the real `skeleton` lane.
On `audit-all`, a pass means the agent named `audit all` for that same ask.

If both arms pass, the CLI contract changed the answer. The prompt did not.

## Why a Read of AGENTS.md does not pass `must`

AGENTS.md lists the exact token line after each ask.
The rubric requires that line in the reply.
0.3.8 ignores the file body.

The first column matches the human prompt, so nearby tokens do not swap.
`audit-all` copies `DUPLICATE_BILLING_SUMMARY` only for the webhook ask.

Suite file: [agent-suites/cli-efficacy/scenarios.json](../../agent-suites/cli-efficacy/scenarios.json).
Fixtures: [tests/fixtures](../../tests/fixtures).
