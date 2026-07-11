# Skeleton — plan scrutiny log

This file stores plan scrutinies and open implementation work for the Skeleton Agent Harness. Update after each scrutiny pass.

**Source plan:** `.cursor/plans/skeleton_agent_harness_90c69108.plan.md`
**Related:** `.cursor/plans/skeleton_postprint_migration.plan.md`

---

## Scrutiny pass — 2026-07-11 (typo fixes + open queue)

### Verdict

**Start Phase 1a.** Typos fixed inline; D1–D3 resolved (see below). Harder items in H-queue.

### Execution order (canonical)

```
1a → 1b → 1c → 4 (publish v1) → 2 (toolbox) ─┐
                              ↘ 1.5 (plugins) ─┴→ 3 (PostPrint)
```

---

## Fixes applied this pass (plan typos / clarity)

| #   | Fix                                                                                              |
| --- | ------------------------------------------------------------------------------------------------ |
| 1   | Config: "two required keys" + optional `plugins` (v1.5)                                          |
| 2   | Dropped-table key names: `docMeta.files`/`globs`, `rulesExcerptFiles`, `deployDocPattern` (dead) |
| 3   | `staleReviewDays` → `daysUntilStale` rename noted                                                |
| 4   | Validate routing: `.yml`, `.zsh`, JSONC-tolerant syntax check                                    |
| 5   | prose-policy split: engine in v1.5 **core**, YAML in **plugin**                                  |
| 6   | `touch-targets.ts` added to PostPrint-local scripts (both plans)                                 |
| 7   | CLI table: `--only`, `--json`, `--dry-run` on audit commands                                     |
| 8   | Frontmatter: Phase 4 publish todo added                                                          |
| 9   | Plan execution guide: when to stop and ask vs fix inline                                         |

| 10 | D1–D3 decisions recorded: CI two-pass global rules; `scan.retiredSkills`; coverage noise OK |

---

## Open work queue (harder — not typos)

Check off when done.

### DECIDE — resolved 2026-07-11

| ID  | Decision                                                                                                                                                                                                                            |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | **Global rules:** pre-commit/`--staged`/local HEAD → path-scoped only. **`validate:ci` (`--base`)** → global rules first, then path-scoped. Full `audit self` → all rules. PostPrint may keep separate pre-commit hooks optionally. |
| D2  | **`scan.retiredSkills: []`** — optional consumer config; used by `links` + `skill-index`.                                                                                                                                           |
| D3  | **coverage-gaps:** built-in excludes only; PostPrint warn noise OK until tuned in Phase 3 migration.                                                                                                                                |

### Implement — phase work

| ID  | Item                                                             | Phase | Notes                                                                                      |
| --- | ---------------------------------------------------------------- | ----- | ------------------------------------------------------------------------------------------ |
| H1  | **`global` rule flag + CI two-pass**                             | 1b    | done — D1: `--base` runs global then path-scoped; `--staged`/HEAD path-scoped only         |
| H2  | **`scan-roots`** — fail when declared scan trees missing on disk | 1a    | done — PostPrint `validateScanRoots()`; globs alone match nothing silently                 |
| H3  | **`links` full port checklist**                                  | 1a    | done — `#anchor`, agent-file links, placeholder skip, `retiredSkills` refs                 |
| H4  | **`scan.retiredSkills` config**                                  | 1a    | done in schema + links; skill-index deferred to 1b                                         |
| H5  | **Nested skill exclusions**                                      | 1b    | done — exclude `references`, `_shared`; `align-commands` non-public                        |
| H6  | **doc-meta hardcoded targets**                                   | 1a    | done — registry-listed docs, hub READMEs, files with existing doc-meta                     |
| H7  | **`draftPathPrefixes` semantics**                                | 1.5   | PostPrint uses as prose-policy _allow-list_ for draft markers — not same as `scan.exclude` |
| H8  | **PostPrint git-diff delegation**                                | 3     | Wrapper forwards `--base`; keeps routing buckets                                           |
| H9  | **Integration tests: global-rule scoping**                       | 1b    | done — path-scoped skips global; `--base` two-pass per D1                                  |
| H10 | **Plugin prose-policy engine**                                   | 1.5   | Generic matcher in core; PostPrint YAML in plugin                                          |
| H11 | **PostPrint migration plan expansion**                           | 3     | File lists, rollback, PR breakdown                                                         |

---

## Phase 1b checklist

- [x] `skill-roots.ts` + port `skill-index`, `links` resolution
- [x] `validate changed` (path routing, `--staged`, `--base`; JSON skip by basename)
- [x] `register`, `customize/resolve.ts` (shared module)
- [x] `hooks/customize-on-skill-read.ts` + dual build `dist/hooks/` + platform adapter unit tests
- [x] CLI integration tests + fixtures (`flat-skill-root`, `nested-skills-customize`); global-rule scoping (H1, H9)
- [x] H5 nested skill exclusions (`references`, `_shared`; `align-commands` non-public)

---

## Phase 1a checklist (next implementation work)

- [x] Package scaffold (`package.json`, `tsconfig`, `bun test` harness)
- [x] `schemas/config.schema.json` + `src/audit/config/load.ts`
- [x] Port `collect`, `links`, `registry`, `banned`, `coverage-gaps` from PostPrint
- [x] Port `scan-roots` (H2) — or document explicit drop
- [x] Banner format: `**Source of truth for** …` (not `**SSOT:**`)
- [x] Registry parse integrity (0 rows with table header → fail)
- [x] Build pipeline: `dist/cli.js` only (hook bundle deferred to 1b)
- [x] Unit tests for all Phase 1a rules
- [x] Dogfood `.skeleton/config.yaml` + `registry.md` in skeleton repo
- [x] Resolve D1–D3 before Phase 1b validate-changed wiring — **D1–D3 resolved 2026-07-11**

---

## Prior passes (summary)

**Post-fix re-scrutiny:** hook identity regex, shared `customize/resolve.ts`, execution order, fixtures, JSON basename routing — all in plan.

**Earlier pass:** dual build, `src/init/` layout, validate scope boundary, registry integrity guard, Phase 4 scope — all in plan.

---

## How to use this file

1. **After each plan scrutiny** — append a dated section; move resolved items to "Fixes applied."
2. **Before implementing DECIDE items** — ask user; record answer here + update plan.
3. **During implementation** — check off Phase checklist and H-items.
4. **Before publish** — D1–D3 resolved; Phase 1a–1c checklist complete; no open H-items blocking publish.
