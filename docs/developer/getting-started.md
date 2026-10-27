# Getting started

<!-- source-of-truth: day-one Skeleton setup in a consumer repo -->

<!-- doc-meta: owner=eng -->

<!-- review-deps: paths=src/init/**,src/cli.ts,src/context.ts -->

Add Skeleton to a repo in six steps. Flag details: [install](install.md). Every config key: [config](config.md).

Day-one CLI: `init`, then `audit` / `validate` / `route` / `catalog`; `review prepare` before a pull request. Init implementation: `runInit` (`InitOptions` → `InitResult`) in `src/init/init.ts`; optional `skillsAddArgs` for `--skills`. Dispatch lives in `src/cli.ts`.

## 1. Install and init

```bash
npm install -D @csark0812/skeleton
npx skeleton init --skills
```

Init writes `skeleton.toml`, writes `.pre-commit-config.yaml`, adds `.skeleton/catalog.md` to `.gitignore`, adds `validate:changed` / `validate:ci` scripts to `package.json`, and appends an idempotent `skeleton context` guide to `AGENTS.md`. Context returns the owning document, its declared source, and the nearest focused test when one matches; when it can derive the repository-native runner, it also returns `test-command`. Whole-file excerpts are marked `whole-file`, and `reference` lines list every tracked file and line that names a code identifier from the request. A `no-context` result includes a recovery action: inspect nearby code, tests, and docs; repair an existing owner or create canonical docs for durable behavior; then rerun the same request until it finds the owner. Read-only tasks report the gap without editing. The guide also tells agents to complete structured context actions, preserve existing work, and run the returned test command once without rereading returned files. It does not route ordinary source tasks through audits or validation unless the user requested them or the focused test fails. Before a pull request it tells agents to run `skeleton review prepare --base <base branch>` and stop on any human-review path. With `--skills`, init also copies the Skeleton skill bundled with the installed package so agent guidance matches that package version.

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

A change to a file a document declares in `review-deps` must update that document in the same commit; pre-commit blocks it otherwise, and nothing records reviews ([keeping documents current](doc-system.md#keeping-documents-current)). Optional `[reviewCoverage]` sets which code paths must have an owning paper. Omit it to use the built-in code defaults. Set `include = []` to disable that gate.

## 3. Write a canonical doc

Create a file with a source-of-truth marker and (for indexes / SSOT docs) doc-meta:

```markdown
# API conventions

<!-- source-of-truth: Backend API conventions -->

<!-- doc-meta: owner=eng -->

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

A foreign-only skill change can pass because synced
skill bodies are validated in their owning repo; `validate changed` prints each
skip. Any changed repository file also pulls in documents whose `review-deps` marker matches it. When the change leaves such a document untouched, re-read it and update it in the same commit. Re-read-cadence warnings remain advisory unless `--strict`. Failures →
[troubleshooting](troubleshooting.md).

Context emits review actions for a document with no declared `review-deps` (`unreviewed`), a declared source that changed in the working tree or index while the document did not (`changed-since-review`), and a document whose last commit is older than the configured cadence (`review-required`). Without declared sources, compare active implementation claims with source; historical alternatives and future aspirations remain qualified intent. `current` means the declared sources read as committed, not that the document agrees with them.

Each matching paper receives a share of the excerpt budget so one broad owner cannot consume it all. `omitted` and `omitted-source` list excluded papers and declared sources, with an action to narrow the query, increase `--max-chars`, or report the remaining evidence limit. Review status compares the full declared dependency set, including files removed from a glob, even when excerpts are omitted. Complete the relevant review and omission actions before treating the packet as sufficient evidence.

Consumer prevention also requires `review-deps` for active implementation claims and running `validate changed` on source changes. Use a scoped `[reviewCoverage]` policy to reject unowned paths where ownership is required. A doc-only hook or `include = []` leaves those source changes outside the ownership gate. Skeleton does not infer semantic conflicts from prose.

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
