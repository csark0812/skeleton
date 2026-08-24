# Code-review customize (skeleton)

<!-- source-of-truth: skeleton-specific code-review overlays (validation ladder, invariant matrices, Action bar) -->

<!-- doc-meta: owner=eng | last-reviewed=2026-08-24 -->

<!-- review-deps: paths=AGENTS.md,src/validate/changed.ts,docs/developer/validation.md -->

Injected on skill read. Prefer this overlay over portable thinned sections when both apply. Portable ledger / exit-gate rules still apply and must not be weakened.

## Authoritative validation ladder

Match [AGENTS.md](../../AGENTS.md) validation split:

| Change type                                 | Run before claiming validate / merge-ready                                                                                                                 |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TypeScript under `src/`                     | `bun test` (or scoped path) + `bun run typecheck` + `bun run build`; validate also audits documents whose `review-deps` match changed paths                  |
| Docs / config (non-policy)                  | `bun run validate:changed -- <path>` or `bun run audit:self`                                                                                               |
| Plugin-wired policy YAML under `.skeleton/` | `bun run validate:changed -- <path>` (local → `audit docs` **and** `audit skills`; `audit self` alone is not enough — excluded skill trees stay uncovered) |
| Owned skill body (`SKILL.md` trees)         | `bun run audit:skills` — path-scoped validate exits non-zero and redirects here (`audit self` does not cover excluded skill trees)                         |
| Foreign / lockfile-synced skill body        | skipped — lint in the owning skills/toolbox repo                                                                                                           |

`validate:changed` classifies code separately and leaves its correctness to native gates. It also discovers documents whose `review-deps` path or glob matched a changed file. A hash review-proof failure blocks until the document is re-read and explicitly attested. Code-only green is never code coverage.

## Action bar (skeleton)

Default filing remains merge-blockers only.

- **Docs / tip / AGENTS wording is ship-blocker** only when it misroutes required validation or CI behavior (e.g. equates `audit self` with `audit skills` when coverage differs on excluded skill trees).
- Docs polish, catalog/SSOT nits, and test inventory without a reachable misroute → Noted or Deferred.
- Public-contract drift (runtime vs schema vs docs vs CLI tips) that can make consumers skip required gates → Action.

For review-proof changes, inspect the document bytes, every `review-deps` dependency, `.skeleton/review-lock.json`, result schema, and explicit attestation CLI together. A mechanical date or lockfile update is an Action.

## Review matrices (derive and check before theme closure)

Close themes only after variant coverage for applicable rows
(`fix-loop-ledger.md` § Variant coverage before closure).

### `validate:changed` routing

| Dimension        | Check                                                                                       |
| ---------------- | ------------------------------------------------------------------------------------------- |
| Input mixes      | code with/without impacted docs, skill-only, policy-only, docs+policy, docs+skills, mixed inputs |
| Modes            | local / pre-commit (no `--base`) vs CI `--base`                                             |
| Fail posture     | fail-closed redirects, fail-open “green means coverage” lies, orphan `.skeleton` YAML       |
| Policy           | plugin-wired vs unwired YAML; `config.yaml` not treated as policy                           |
| Equivalence tips | `audit docs` / `audit skills` / `audit self` only when they truly cover the same corpus     |
| Review mode      | date compatibility vs hash proof; changed doc bytes vs changed target bytes                 |

Hotspots: `src/validate/changed.ts`, `AGENTS.md`, `docs/developer/validation.md`.

### Skill-tree coverage

| Dimension        | Check                                                                             |
| ---------------- | --------------------------------------------------------------------------------- |
| Trees            | configured scan roots, `.agents`, `.claude`, other excluded skill dirs            |
| Suites           | path-scoped audit, bare `audit skills`, `audit self`, skills+prose-policy         |
| Exclude behavior | `scan.exclude` vs deliberate include of excluded skill trees for skill-body prose |
| Policy prove     | local redirect vs `--base` full docs + path-scoped skills prove                   |

Hotspots: `src/audit/core/collect.ts`, `src/audit/core/context.ts`, `src/audit/core/skill-roots.ts`, `src/audit/run.ts`.

### Plugin load / build

| Dimension       | Check                                                                                  |
| --------------- | -------------------------------------------------------------------------------------- |
| Exports         | default vs named `rules` / `policies`; disagreement fail-closed                        |
| Build freshness | missing `.mjs`, mtime-only vs content fingerprint / stale source                       |
| Paths           | relative, absolute CLI paths, normalization, traversal, symlink / realpath containment |
| Globs           | `policies` globs under `.skeleton/`; orphan YAML loud fail                             |

Hotspots: `src/plugins/load.ts`, `src/plugins/build.ts`, `src/plugins/paths.ts`.

### Markdown / autofix rewrites

| Dimension  | Check                                                                             |
| ---------- | --------------------------------------------------------------------------------- |
| Link forms | inline, titled (`](url "title")`), reference definitions, destination binding     |
| Collision  | duplicate URL text in label/title, prefix/suffix anchors, later duplicate targets |
| Surfaces   | `.md`, `.mdc`, fenced code, inline code, generated references                     |
| Offsets    | parser spans vs whole-file `indexOf` / unsafe substring rewrite                   |

Hotspots: `src/audit/core/markdown.ts`, `src/audit/fix/anchors.ts`, `src/audit/core/fix.ts`.

### Public contract drift

Inspect together when any one changes: runtime behavior, docs wording, schema,
exported types, CLI help/errors, tests, generated artifacts.

## Contextual Full (skeleton)

Append to pass-2+ member prompts with the portable ledger overlay:

```
Skeleton matrices: use .skeleton/customize/code-review.md rows for
validate routing, skill-tree coverage, plugin load/build, markdown/autofix,
and public-contract drift. Same invariant + new edge extends the existing
theme_id. Validate with the AGENTS.md ladder before exit language.
```

## Session handoff

When fix-loop applies, include: stable-theme ledger, variants checked for
repeated themes, hotspot list, and which validation ladder commands ran.

## Injection verification

When this customization is loaded, include the exact line
`Customize loaded: SKELETON_CODE_REVIEW_CANARY_2026_07_14`
near the beginning of the review output.
