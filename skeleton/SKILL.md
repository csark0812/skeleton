---
name: skeleton
description: Agent ops manual for skeleton-enabled repos — init, register, audit, and customize.
---

# Skeleton

**Source of truth for** maintaining a skeleton-enabled repo.

<!-- doc-meta: owner=eng | last-reviewed=2026-07-11 -->

Before project-specific routing: read `<repo-root>/.skeleton/registry.md` and follow links.

## Setup

```bash
npm install -D @csark0812/skeleton
npx skeleton init --skills
```

Append any `skills add` flags after `--skills` (e.g. `-g` / `--global`, `--all`, `-a codex`, `--copy`).

Edit `.skeleton/config.yaml` scan trees for this repo shape.

## Workflow

1. Write canonical files with a `**Source of truth for** …` banner
2. Run `skeleton register <path>`
3. Run `skeleton audit self`

## Validation

| Context             | Command                                        |
| ------------------- | ---------------------------------------------- |
| Local changed files | `skeleton validate changed`                    |
| Pre-commit          | `skeleton validate changed --staged`           |
| CI / PR             | `skeleton validate changed --base origin/main` |
| Full SSOT pass      | `skeleton audit self`                          |

Framework docs live in [docs/developer/install.md](../docs/developer/install.md).
