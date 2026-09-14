# Validation

<!-- source-of-truth: skeleton validate changed routing -->

<!-- doc-meta: owner=eng | last-reviewed=2026-09-13 -->

<!-- review-deps: paths=src/validate/** -->

Run `skeleton route` for the lane card. Run `skeleton route <path>` to classify one path. Those commands do not audit.

Prove the change with `runValidateChanged` / `evaluateValidateChanged` (`ValidateChangedOptions`). Code paths get a `codeValidationHint` for native gates. Review-deps papers are discovered from any changed path. A live coverage candidate with no owning paper fails `uncovered-changed-path`. Deleted files do not.

## When you changed X, run Y

| You changed                                               | Run                                                                                          |
| --------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Docs, catalog, non-policy `.skeleton/` / `skeleton.toml`  | `skeleton validate changed <path>` or `skeleton audit self`                                  |
| Owned skill body (`SKILL.md` trees authored in this repo) | `skeleton validate changed` (runs the skills suite) or `skeleton audit skills`               |
| Foreign / lockfile-synced skill body                      | skipped — lint in the owning skills/toolbox repo                                             |
| Plugin-wired policy YAML under `.skeleton/`               | `skeleton validate changed` (runs full docs and owned-skill prose)                           |
| TypeScript / app code                                     | Repo-native gates plus owning-paper review. Unowned coverage candidates fail                 |
| `package.json` / `project.json`                           | Same coverage and `review-deps` discovery as other claimed paths                             |
| Missing paths                                             | Pass real paths, or use `--staged` / `--base`                                                |

Common failures: [troubleshooting](troubleshooting.md). Suites and rule scoping: [audit](audit.md).

## Commands

```bash
skeleton route                         # lane card; no audit
skeleton route <path>                  # classify only; no audit
skeleton validate changed              # git diff HEAD
skeleton validate changed --staged     # pre-commit
skeleton validate changed --base origin/main  # CI merge-base diff
```

## Path routing

| Path                                                                                | Action                                                                                                                                                                           |
| ----------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Docs in scan perimeter                                                              | `audit docs` (path-scoped)                                                                                          |
| Owned skill trees (`SKILL.md` perimeter)                                            | Local: full `audit skills`. CI `--base`: global skill rules plus path-scoped skills                                 |
| Foreign skill trees (`skills-lock.json` github / non-local provenance)              | skip with a log line — body lint belongs upstream                                                                   |
| Plugin-wired policy YAML under `.skeleton/`                                         | Schema check, then full docs plus path-scoped skills over **owned** skill-tree markdown                             |
| Other `.skeleton/**` YAML (not `config.yaml`, not plugin-wired)                     | exits non-zero — not referenced by any plugin `policies` glob                                                       |
| `.sh`, `.bash`, `.zsh`                                                              | shellcheck or `bash -n`                                                                                             |
| Other `.json`                                                                       | JSONC-tolerant syntax check                                                                                         |
| Any changed repository file                                                         | discover and audit scanned docs whose `review-deps` path or glob matches                                            |
| Coverage-candidate code or `package.json` / `project.json`                          | fail `uncovered-changed-path` when the file still exists and no scanned paper claims it                              |

### Code paths and impacted documents

Skeleton does not claim to validate application code. It classifies code paths, prints the repo-native gates, and builds an exact reverse dependency map from `review-deps` declarations to scanned documents.

- Hash mode: changed dependency bytes make the linked document's `review-proof` entry invalid until explicit re-review and attestation.
- Date mode: a linked document must be included in the changed set and carry today's explicit review date.
- No linked document: a live coverage-candidate path fails with `uncovered-changed-path` on local and `--base` runs. Mixed commits do not hide this. Deleted files do not fail that gate.
- `--staged`: read document, lockfile, and dependency bytes from the git index. If an impacted paper or the hash lockfile differs from HEAD and is not staged, fail `stage-required`.

In this repo:

```bash
bun test
bun run typecheck
bun run build
```

Mixed doc+code paths audit both directly changed and discovered impacted documents. Plain-text output prints one `file: error:` diagnostic per failed document and a `changed:` line for the files that triggered it.

### Skill-body paths

Skill bodies are not path-scoped on the docs lane.

**Owned** skill paths (alone or mixed with docs) run the full skills suite locally. Under CI `--base`, global skill rules and path-scoped owned-skill prose still run.

**Foreign** skills (`skills-lock.json` entries with `sourceType` other than `local`, e.g. `github`) are skipped so consumer repos don't double-lint synced toolbox copies — including doc-meta on SSOT-bearing skill `references/**` paths. Override with `skillOwnership.ownedSlugs` / `foreignSlugs` — see [config](config.md#skillownership).

`audit self` covers the scan corpus; excluded owned skill trees still need `audit skills`.

### Plugin policy YAML

Policy YAML is plugin-glob SSOT only (same as runtime `loadPlugins`):

- Unwired `.skeleton/**/*.yaml` (not `config.yaml`) fails loud — wire it via a plugin `policies` glob or move it.
- Wired policy changes need a full docs **and** skills prose pass for new patterns.
- Local / pre-commit and CI `--base` both run that prove. `audit self` alone does not cover excluded skill trees.

### CI two-pass

`validate:ci` (`--base`) runs **global rules first** (`deny.paths` via rule `banned`, coverage-gaps, review-coverage, scan-roots, skill-index, ssot, near-duplicate, ssot-summary), then path-scoped audit on changed files. Uncovered coverage-candidate paths fail here too. When the diff includes **wired policy YAML**, CI runs the full docs + skills prove. Pre-commit uses `--staged` and the same coverage and policy prove.

## Agent-readable result

`validate changed` deliberately emits compact plain text: audit diagnostics, affected documents, the dependency that matched, next native gates, and a final pass/fail line. It has no JSON mode or published result contract. Agents can use the exit status and the action-bearing output directly.

## Shared references

Keep shared reference files wherever they fit the repository, and include local reference paths in `scan.include` when Skeleton should audit them. Local Markdown links receive the normal broken-path and anchor checks.

Skills in a public repository can link directly to an ordinary GitHub-hosted file. Use a stable public URL, for example:

```md
[Shared guidance](https://raw.githubusercontent.com/example/toolbox/main/references/shared-guidance.md)
```

Skeleton does not copy shared files into skills, rewrite their links, or fetch external URLs. Remote reachability belongs to the publishing repository or a separate network check. Keep references inside a skill only when that skill owns the behavior.

See [audit](audit.md).

## CLI efficacy

Host compares score these lanes on intact vs contested fixtures.

```bash
bun run agent:test
```

Details: [CLI efficacy](cli-efficacy.md).
