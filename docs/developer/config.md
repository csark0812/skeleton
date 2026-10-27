# Config

<!-- source-of-truth: keys and examples -->

<!-- doc-meta: owner=eng -->

<!-- review-deps: paths=src/audit/config/** -->

Machine schema: [`schemas/config.schema.json`](../../schemas/config.schema.json) (validates the loaded object). Init template: `templates/skeleton-init/skeleton.toml`. Day-one walkthrough: [getting started](getting-started.md).

Loader: `loadConfig` / `loadConfigDetailed` / `findRepoRoot` / `mergedExcludes` in `src/audit/config/load.ts`. Typed shape: `SkeletonConfig` (`ScanConfig`, `DocsLintConfig`, `DenyConfig`, `SkillOwnershipConfig`, `ReviewProofConfig`, `ReviewCoverageConfig`).

Preferred path: **`skeleton.toml` at the repo root**. Legacy `.skeleton/config.yaml` still loads when no TOML is present. If both exist, TOML wins and the CLI warns that YAML is ignored.

## Required

Top-level required keys: `scan` and `daysUntilStale`. Inside `scan`, required: `include`, `exclude`.

| Key              | Purpose                                                                                      |
| ---------------- | -------------------------------------------------------------------------------------------- |
| `scan.include`   | Glob patterns for markdown/docs/skills in the audit perimeter (links, doc-meta, SSOT)        |
| `scan.exclude`   | Removed from the perimeter (drafts, refs, local install trees)                               |
| `daysUntilStale` | Re-read **cadence**: warn (error under `--strict`) when the attest commit of the review that covers a document's current bytes is older than N days — not the same as “edited after review” (that is a hash mismatch; see [doc system](doc-system.md#doc-meta)) |

## Optional

| Key                       | Purpose                                                                                                 |
| ------------------------- | ------------------------------------------------------------------------------------------------------- |
| `deny.paths`              | Repo-wide globs that **must not exist** — audit fails if matched (often outside `include`)              |
| `scan.nonPublicSkills`    | Slugs on disk that must **not** appear in nested skills README `## Taxonomy`                            |
| `plugins`                 | Plugin entry paths relative to `.skeleton/` (each needs a built sibling `.mjs`) — [plugins](plugins.md) |
| `draftPathPrefixes`       | Allow-list prefixes for draft-marker prose policy (plus `_draft-*.md`). Not `scan.exclude`              |
| `skillOwnership`          | Provenance-aware skill body linting (see below)                                                         |
| `review`                  | Human-review globs and an optional reviewer command for `review prepare` ([code review](review.md)) |
| `reviewProof`             | Review proof lives in commit history (always on); `file` only locates a Skeleton 8 lock to migrate (see below) |
| `reviewCoverage`          | Globs that must appear in at least one scanned paper's `review-deps` (see below)                       |
| `docsLint`                | Near-duplicate / SSOT-summary thresholds and ignore pairs (see below)                                  |

Deleted skills need no denylist: links to missing `…/SKILL.md` fail under the links / skill-index rules.

Hard cut: `scan.banned` and `scan.retiredSkills` are rejected by the schema — use `deny.paths` instead of `banned`.

## `deny`

```toml
[deny]
paths = ["apps/**/*_ANALYSIS.md"]
```

## `docsLint`

| Key                      | Purpose                                                              |
| ------------------------ | -------------------------------------------------------------------- |
| `nearDuplicateThreshold` | Jaccard on word shingles (default `0.72`); warn / `--strict` → error |
| `ssotOverlapMin`         | Min fraction of stemmed SSOT tokens in H1/lead/body evidence (default `0.35`) |
| `ssotBetterMatchMargin`  | Sibling must beat own overlap by this much for better-match (default `0.15`) |
| `ssotPhraseCheck`        | When overlap fails, mention missing SSOT phrase in the message (default `true`) |
| `ignorePairs`            | Path pairs skipped by near-dupe / duplicate-SSOT                     |
| `ignoreGlobs`            | Globs skipped by near-dupe / duplicate-SSOT                          |

`ssot-summary` scores stemmed unigrams against H1 + lead + body (SSOT line stripped). Exact phrase match only explains a failed overlap — abstract titles can pass without verbatim phrasing. Better-match warns only when own overlap is weak and another SSOT paper fits better; the message lists rewrite / retarget / consider-combine options.

`review-deps`: opt-in HTML comment markers with comma-separated `paths=`. Docs may declare exact repo-relative files or globs. Exact missing files error; empty globs warn (or error under `--strict`). A whole `package.json` dependency warns `review-dependency-broad`, and documents that depend on each other warn `review-dependency-cycle`. See [doc system](doc-system.md#doc-meta).

## `reviewProof`

Review proof is always on and lives in commit messages, so no tracked file records it. `skeleton attest <doc…>` adds one empty commit on HEAD whose message carries a line per document:

```text
Skeleton-Reviewed: docs/api.md doc=sha256:2b7f90e14c6ad388 deps=sha256:d04c18e5f9a273b6
Skeleton-Review-Note: docs/api.md checked the retry limit against the client
```

The note line appears only with `--reason`: the reason given when a re-attest left the text unchanged. `review prepare` shows it to the reviewer. A path with a space or a quote is written as a JSON string.

`doc` digests the document with its doc-meta comment replaced by a fixed token, so editing an owner never invalidates a review. `deps` is one digest over every resolved `review-deps` target and its own digest, so both a changed file and a changed dependency set invalidate the review (`none` when there are none). A Markdown dependency is compared without its doc-meta comment. Digests are 64-bit prefixes of SHA-256: change detection, not a security boundary.

A document passes while some review reachable from HEAD recorded exactly its current `doc` and `deps` digests. Lines are read anywhere in a message, because a squash merge joins every commit body into one. Keep commit messages when squash-merging (GitHub: "Default to commit messages"); a squash message without the lines drops the review, and the document then fails on the default branch. Proof is read from history: a shallow clone reports `review-history-unavailable`, so CI must fetch full history.

Nothing tracked changes, so two branches that review the same document never conflict, and git merges the document itself as usual. If both edits land, no one has read the combined text. When no review matches and the latest first-parent commit that changed the document or its dependencies landed a review of it (a squash whose message has its line, or a merge whose merged side does), the audit reports `review-merged-unattested`: a warning in a repository-wide audit, and an error in a path-scoped audit or `validate changed`, so whoever touches the document next re-reads the combination. A conflict resolution inside a merge commit is never counted as reviewed. The re-read cadence uses the committer day of the matching attest commit. When a dependency changed, the audit names it by comparing each dependency with its content at the latest attest commit.

`review-deps` can narrow a JSON dependency to key paths, for example `package.json#scripts,package.json#bin`. The digest then covers only those keys (a missing key counts as evidence too); impact discovery still treats any change to the file as touching the document. Selectors work only on one `.json` file, not on a glob.

`mode = "hash"` is still accepted. `file` names a Skeleton 8 lock (default `.skeleton/review-lock.toml`) and is read only by `skeleton attest --migrate`. While that lock exists, a repository-wide audit reports `review-lock-retired`. `--migrate` makes one commit that deletes the lock and carries a review line, dated with `since=<day>` from the commit that recorded the entry, for every entry that still verifies; entries that no longer verify are listed and need a fresh review. It never attests anything new. Skeleton 5, 6, and 7 proof must first be repaired with Skeleton 8 (`attest --repair`).

One exception covers release metadata. A dependency named `package.json` is digested as parsed JSON without its top-level `version` field. A release version bump or a whitespace-only edit therefore keeps the review valid. Any other manifest change, such as `scripts`, `engines`, `bin`, or dependencies, still invalidates it. A manifest that is not a JSON object is compared byte for byte.

## `review`

```toml
[review]
humanPaths = [".github/workflows/**", "src/auth/**"]
command = "./scripts/review-agent.sh"
```

Both keys are optional. `humanPaths` lists globs for high-consequence paths; `skeleton review prepare` names every changed path that matches, because an agent review does not count for them. `command` is a shell command that receives the review bundle on stdin when you run `review prepare --run`. See [code review](review.md).

## `reviewCoverage`

```toml
[reviewCoverage]
include = ["src/**/*.ts", "package.json"]
exclude = ["src/**/__tests__/**", "src/**/*.test.ts"]
```

Files that match `include` (minus `exclude` and built-in test or fixture excludes) must appear in at least one scanned paper's `review-deps`. The global `review-coverage` rule checks the whole set. `validate changed` also fails `uncovered-changed-path` when a changed candidate has no owner.

Omit the section to use built-in code defaults (`**/*.{ts,tsx,js,jsx,mjs,cjs,py}`, `package.json`, `project.json`). Built-in excludes drop tests, fixtures, templates, nested `node_modules` / `dist` / `.venv`, and `.skeleton/plugins/**`. Production `.mjs` stays in the coverage set. Set `include = []` to disable the gate.

## `skillOwnership`

When a consumer repo syncs skills from a toolbox (via `skills-lock.json`), Skeleton skips foreign skill **bodies** so linting stays with the owning repo. That skip covers skill-body lint (`audit skills`), path-scoped validate routing, and **doc-meta** for paths under foreign skill trees — including SSOT-bearing `references/**` files.

| Key            | Purpose                                                                 |
| -------------- | ----------------------------------------------------------------------- |
| `lockfile`     | Repo-relative lock path (default `skills-lock.json`)                    |
| `ownedSlugs`   | Force these slugs owned (lint here) even if the lock marks them foreign |
| `foreignSlugs` | Force these slugs foreign (skip body lint) even if absent from the lock |

Default rules without overrides:

- Lock entry `sourceType: github` (or any non-`local`) → foreign
- Lock entry `sourceType: local`, or slug not in the lock → owned

```toml
[skillOwnership]
lockfile = "skills-lock.json"
# ownedSlugs = ["skeleton"]
# foreignSlugs = ["experimental-local-copy"]
```

See [audit](audit.md#skill-ownership-consumer-vs-toolbox) and [validation](validation.md#skill-body-paths).

## What affects validate vs full audit

| Concern                              | Keys / behavior                                                                                                                           |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Path-scoped `validate changed`       | Files in `scan.include` (minus exclude) get docs audit; owned skill trees run the skills suite; foreign lock skills skip; coverage-candidate code without an owning paper fails |
| Global rules (`--base` / full audit) | `deny.paths` (rule `banned`), SSOT dual/malformed, near-dupe, ssot-summary, coverage outside include, review-coverage, scan-roots, skill-index |
| Prose policies                       | Idle until `plugins` contribute policy YAML                                                                                               |
| Skill body ownership                 | `skillOwnership` + `skills-lock.json` (foreign bodies skipped)                                                                            |
| Catalog                              | Local audit and `validate changed` write `.skeleton/catalog.md` on each run; skipped when `CI=true`                                       |

## Example: toolbox / docs-only

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

## Example: app with plugins

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

plugins = ["plugins/example/example.ts"]
```

Legacy YAML is still accepted when `skeleton.toml` is absent — same keys under `.skeleton/config.yaml`.
