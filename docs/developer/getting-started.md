# Getting started

<!-- source-of-truth: day-one Skeleton setup in a consumer repo -->

<!-- doc-meta: owner=eng | last-reviewed=2026-09-17 -->

<!-- review-deps: paths=src/init/**,src/cli.ts -->

Add Skeleton to a repo in six steps. Flag details: [install](install.md). Every config key: [config](config.md).

Day-one CLI: `init`, then `audit` / `validate` / `route` / `catalog`. Init implementation: `runInit` (`InitOptions` → `InitResult`) in `src/init/init.ts`; optional `skillsAddArgs` for `--skills`. Dispatch lives in `src/cli.ts`.

## 1. Install and init

```bash
npm install -D @csark0812/skeleton
npx skeleton init --skills
```

Init writes `skeleton.toml`, writes `.pre-commit-config.yaml`, adds `validate:changed` / `validate:ci` scripts to `package.json`, and appends an idempotent `skeleton context` guide to `AGENTS.md`. Context returns the owning document, its declared source, and the nearest focused test when one matches. The guide tells agents to complete structured context actions, preserve existing work, and run that focused test without rereading returned files. It does not route ordinary source tasks through audits, validation, or review-proof commands unless the user requested them or the focused test fails. With `--skills`, init also copies the Skeleton skill bundled with the installed package so agent guidance matches that package version. Hash review proof is on by default.

## 2. Set the scan perimeter

Open `skeleton.toml` and define what Skeleton should scan.

### Toolbox / docs-only repo

```toml
daysUntilStale = 365

[scan]
include = [
  "docs/**",
  "README.md",
  "AGENTS.md",
]
exclude = ["refs/**"]

[deny]
paths = []
```

### App repo with skills

```toml
daysUntilStale = 365

[scan]
include = [
  "docs/**",
  "README.md",
  "AGENTS.md",
  ".claude/skills/**",
]
exclude = [
  "refs/**",
  "**/_draft-*/**",
]

[deny]
paths = ["apps/**/*_ANALYSIS.md"]
```

Skill ownership is inferred from `skills-lock.json`: local skills are owned,
while synced skills (for example, `sourceType: github`) are foreign. Consumer
validation skips foreign skill bodies; lint those in the owning skills or
toolbox repo. Use `skillOwnership.ownedSlugs` / `foreignSlugs` for exceptions;
see [config](config.md#skillownership).

Plugin-enabled example and more keys: [config](config.md).

Init enables hash-backed review evidence:

```toml
[reviewProof]
mode = "hash"
```

Commit `.skeleton/review-lock.json` after the first explicit review. Optional `[reviewCoverage]` sets which code paths must have an owning paper. Omit it to use the built-in code defaults. Set `include = []` to disable that gate.

## 3. Write a canonical doc

Create a file with a source-of-truth marker and (for indexes / SSOT docs) doc-meta:

```markdown
# API conventions

<!-- source-of-truth: Backend API conventions -->

<!-- doc-meta: owner=eng | last-reviewed=2026-08-16 -->

Keep request and response shapes consistent across services.
```

## 4. Refresh the agent catalog

Local `npx skeleton audit docs` and `npx skeleton validate changed` write `.skeleton/catalog.md`. You can also run:

```bash
npx skeleton catalog
```

The file is gitignored. Agents skim it before they open full papers.

## 5. Verify

```bash
npx skeleton audit docs
npx skeleton validate changed --staged
```

Audits pass → you're set. A foreign-only skill change can pass because synced
skill bodies are validated in their owning repo; `validate changed` prints each
skip. Any changed repository file also pulls in documents whose `review-deps` marker matches it. Review failures require a complete re-read, followed by explicit attestation:

```bash
npx skeleton audit docs --paths=docs/example.md --fix=doc-meta --confirm-reviewed
```

Changing the date alone is not a review. Re-read-cadence warnings remain advisory unless `--strict`. Failures →
[troubleshooting](troubleshooting.md).

## 6. Install the git hook

Init writes `.pre-commit-config.yaml` with `skeleton validate changed --staged`. Install [pre-commit](https://pre-commit.com/) once per machine, then:

```bash
pre-commit install
```

Details: [install](install.md).

## Day-one checklist

- [ ] `npm install -D @csark0812/skeleton`
- [ ] `npx skeleton init --skills`
- [ ] Edit `skeleton.toml` scan trees
- [ ] Write a canonical doc with source-of-truth (+ doc-meta as needed)
- [ ] `npx skeleton catalog`
- [ ] `npx skeleton audit docs`
- [ ] `pre-commit install`

## Next

| Goal                                          | Doc                                   |
| --------------------------------------------- | ------------------------------------- |
| Config keys and examples                      | [config](config.md)                   |
| What to run after a change                    | [validation](validation.md)           |
| SSOT / catalog / doc-meta                     | [doc system](doc-system.md)           |
| Product-specific audit rules                  | [plugins](plugins.md)                 |
| Common failures                               | [troubleshooting](troubleshooting.md) |
