# Install

<!-- source-of-truth: installing skeleton in a consumer repo -->

<!-- doc-meta: owner=eng | last-reviewed=2026-08-24 -->

<!-- review-deps: paths=src/init/init.ts -->

Install path runs `runInit` (`InitOptions` / `InitResult`); `--skills` builds `skillsAddArgs` for the skills CLI.

## CLI

```bash
npm install -D @csark0812/skeleton
npx skeleton init --skills
```

`--skills` runs `npx skills add csark0812/skeleton …` with sensible defaults (`--skill skeleton`, `-a cursor claude-code codex`, `-y`). Pass any [skills add flags](https://github.com/vercel-labs/skills) after `--skills` — e.g. `-g` / `--global`, `--all`, `-a codex`, `--copy`, `--list`.

Init writes `skeleton.toml` / `.skeleton/`, may merge **optional** IDE customize hooks, and adds `validate:changed` / `validate:ci` scripts.

## Config

Open `skeleton.toml` and set `scan.include` / `scan.exclude` / optional `deny.paths` for your layout. See [config](config.md).

## Pre-commit (optional)

Install [pre-commit](https://pre-commit.com/) once per machine (`brew install pre-commit` or `pipx install pre-commit`), then in the consumer repo:

```bash
pre-commit install
```

Hook config typically runs `skeleton validate changed --staged`.

## Verify

```bash
npx skeleton audit self
```
