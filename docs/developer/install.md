# Install

**Source of truth for** installing skeleton in a consumer repo.

<!-- doc-meta: owner=eng | last-reviewed=2026-07-14 -->

## CLI

```bash
npm install -D @csark0812/skeleton
npx skeleton init --skills
```

`--skills` runs `npx skills add csark0812/skeleton …` with sensible defaults (`--skill skeleton`, `-a cursor claude-code`, `-y`). Pass any [skills add flags](https://github.com/vercel-labs/skills) after `--skills` — e.g. `-g` / `--global`, `--all`, `-a codex`, `--copy`, `--list`.

Init writes `.skeleton/`, merges IDE customize hooks, and adds `validate:changed` / `validate:ci` scripts.

## Edit config

Open `.skeleton/config.yaml` and set `scan.include` / `scan.exclude` / `scan.banned` for your repo layout. See [doc-system](doc-system.md).

## Pre-commit (optional)

Install the [pre-commit](https://pre-commit.com/) tool once per machine (`brew install pre-commit` or `pipx install pre-commit`), then in the consumer repo:

```bash
pre-commit install
```

Hook config typically runs `skeleton validate changed --staged`.

## Verify

```bash
npx skeleton audit self
```

## Editor extension (optional)

Install the VS Code / Cursor extension for Problems-panel diagnostics on Markdown. See [editor extension](editor-extension.md).
