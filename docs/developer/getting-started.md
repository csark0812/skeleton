# Getting started

<!-- source-of-truth: day-one Skeleton setup in a consumer repo -->

<!-- doc-meta: owner=eng | last-reviewed=2026-08-19 -->

<!-- code-fit: targets=src/init/init.ts surface=runInit,InitOptions,InitResult -->
<!-- code-fit: targets=src/cli.ts surface=init,audit,validate,catalog -->

Add Skeleton to a repo in six steps. Flag details: [install](install.md). Every config key: [config](config.md).

Day-one CLI: `init`, then `audit` / `validate` / `catalog`. Init implementation: `runInit` (`InitOptions` → `InitResult`) in `src/init/init.ts`; optional `skillsAddArgs` for `--skills`. Dispatch lives in `src/cli.ts` (`init` / `audit` / `validate` / `catalog` handlers).

## 1. Install and init

```bash
npm install -D @csark0812/skeleton
npx skeleton init --skills
```

Init writes `skeleton.toml`, ensures `.skeleton/customize/`, may merge **optional** IDE customize hooks, and adds `validate:changed` / `validate:ci` scripts to `package.json`. Hooks are not required for audit.

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

## 3. Write a canonical doc

Create a file with a source-of-truth marker and (for indexes / SSOT docs) doc-meta:

```markdown
# API conventions

<!-- source-of-truth: Backend API conventions -->

<!-- doc-meta: owner=eng | last-reviewed=2026-08-16 -->

Keep request and response shapes consistent across services.
```

## 4. Refresh the agent catalog

```bash
npx skeleton catalog
```

Writes gitignored `.skeleton/catalog.md` from SSOT-bearing files. Agents skim this before opening full papers.

## 5. Verify

```bash
npx skeleton audit docs
npx skeleton validate changed --staged
```

Audits pass → you're set. A foreign-only skill change can pass because synced
skill bodies are validated in their owning repo; `validate changed` prints each
skip. Doc-meta re-read-cadence warnings are OK until you bump dates; edit-behind-review
warnings require re-reading the entire document, then bumping only if it is still correct.
Changing the date alone does not satisfy the check. Failures →
[troubleshooting](troubleshooting.md).

## 6. Optional pre-commit

```bash
pre-commit install
```

Hook configs typically run `skeleton validate changed --staged`. Details: [install](install.md).

## Day-one checklist

- [ ] `npm install -D @csark0812/skeleton`
- [ ] `npx skeleton init --skills`
- [ ] Edit `skeleton.toml` scan trees
- [ ] Write a canonical doc with source-of-truth (+ doc-meta as needed)
- [ ] `npx skeleton catalog`
- [ ] `npx skeleton audit docs`
- [ ] (Optional) `pre-commit install` / IDE customize hooks

## Next

| Goal                                          | Doc                                   |
| --------------------------------------------- | ------------------------------------- |
| Config keys and examples                      | [config](config.md)                   |
| What to run after a change                    | [validation](validation.md)           |
| SSOT / catalog / doc-meta                     | [doc system](doc-system.md)           |
| Skill overrides without editing synced skills | [customize](customize.md)             |
| Product-specific audit rules                  | [plugins](plugins.md)                 |
| Common failures                               | [troubleshooting](troubleshooting.md) |
