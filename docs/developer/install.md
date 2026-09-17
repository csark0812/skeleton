# Install

<!-- source-of-truth: installing skeleton in a consumer repo -->

<!-- doc-meta: owner=eng | last-reviewed=2026-09-17 -->

<!-- review-deps: paths=src/init/** -->

Install path runs `runInit` (`InitOptions` / `InitResult`); `--skills` builds `skillsAddArgs` for the skills CLI.

## CLI

```bash
npm install -D @csark0812/skeleton
npx skeleton init --skills
```

`--skills` runs the skills CLI against the `skeleton/` skill bundled in the installed package. Sensible defaults select only Skeleton, copy it into the consumer, install it for Cursor, Claude Code, and Codex, and skip confirmation (`--skill skeleton`, `--copy`, `-a cursor claude-code codex`, `-y`). This keeps agent guidance aligned with the exact installed package instead of fetching a potentially different revision. Pass any [skills add flags](https://github.com/vercel-labs/skills) after `--skills` — e.g. `-g` / `--global`, `--all`, `-a codex`, or `--list`.

Init writes `skeleton.toml` / `.skeleton/`, writes `.pre-commit-config.yaml`, adds `validate:changed` / `validate:ci` scripts, appends an idempotent `skeleton context` guide to `AGENTS.md`, and installs the bundled skill when `--skills` is present. Context returns the owning document, declared source, and nearest matching focused test. The guide requires agents to use those returned excerpts directly, preserve existing work, and run the focused test. It reserves audits, validation, and review-proof commands for explicit user requests or a failing focused test.

## Config

Open `skeleton.toml` and set `scan.include` / `scan.exclude` / optional `deny.paths` for your layout. See [config](config.md).

## Pre-commit

Init writes a portable `node …/dist/cli.js validate changed --staged` hook. Install [pre-commit](https://pre-commit.com/) once per machine (`brew install pre-commit` or `pipx install pre-commit`), then in the consumer repo:

```bash
pre-commit install
```

## Verify

```bash
npx skeleton audit self
```
