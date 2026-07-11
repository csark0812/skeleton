# Install

**Source of truth for** installing skeleton in a consumer repo.

<!-- doc-meta: owner=eng | last-reviewed=2026-07-11 -->

## CLI

```bash
npm install -D @csark0812/skeleton
npx skeleton init --skills
```

`--skills` runs `npx skills add csark0812/skeleton …` with sensible defaults (`--skill skeleton`, `-a cursor claude-code`, `-y`). Pass any [skills add flags](https://github.com/vercel-labs/skills) after `--skills` — e.g. `-g` / `--global`, `--all`, `-a codex`, `--copy`, `--list`.

Init writes `.skeleton/`, merges IDE customize hooks, and adds `validate:changed` / `validate:ci` scripts.

## Edit config

Open `.skeleton/config.yaml` and set `scan.include` / `scan.exclude` / `scan.banned` for your repo layout. See [doc-system](doc-system.md).

## Verify

```bash
npx skeleton audit self
```
