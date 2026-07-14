# Code-review customize (skeleton)

**Source of truth for** skeleton-specific code-review overlays (validation ladder, invariant matrices, Action bar).

<!-- doc-meta: owner=eng | last-reviewed=2026-07-14 -->

Injected on skill read. Prefer this overlay over portable thinned sections when both apply. Portable ledger / exit-gate rules still apply and must not be weakened.

## Authoritative validation ladder

Match [AGENTS.md](../../AGENTS.md) validation split:

| Change type                   | Run before claiming validate / merge-ready                                                                                      |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| TypeScript under `src/`       | `bun test` (or scoped path) + `bun run typecheck` + `bun run build` (+ `bun run lint` or `bun run check` when breadth warrants) |
| Docs / config / registry      | `bun run validate:changed -- <path>` or `bun run audit:self`                                                                    |
| Skill body (`SKILL.md` trees) | `bun run audit:skills` or `bun run audit:self` — path-scoped validate exits non-zero and redirects here                         |

`validate:changed` skips code and command-config JSON by design. Code-only green from that command is not coverage.

## Action bar (skeleton)

Default filing remains merge-blockers only.

- **Docs / tip / AGENTS wording is ship-blocker** only when it misroutes required validation or CI behavior (e.g. equates `audit self` with `audit skills` when coverage differs on excluded skill trees).
- Docs polish, registry nits, and test inventory without a reachable misroute → Noted or Deferred.
- Public-contract drift (runtime vs schema vs docs vs CLI tips) that can make consumers skip required gates → Action.

## Review matrices (derive and check before theme closure)

Close themes only after variant coverage for applicable rows
(`fix-loop-ledger.md` § Variant coverage before closure).

### `validate:changed` routing

| Dimension        | Check                                                                                       |
| ---------------- | ------------------------------------------------------------------------------------------- |
| Input mixes      | skipped/code-only, skill-only, policy-only, docs+policy, docs+skills, mixed skipped+audited |
| Modes            | local / pre-commit (no `--base`) vs CI `--base`                                             |
| Fail posture     | fail-closed redirects, fail-open “green means coverage” lies, orphan `.skeleton` YAML       |
| Policy           | plugin-wired vs unwired YAML; `config.yaml` not treated as policy                           |
| Equivalence tips | `audit docs` / `audit skills` / `audit self` only when they truly cover the same corpus     |

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
