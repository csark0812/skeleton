# Getting started

**Source of truth for** day-one Skeleton setup in a consumer repo.

<!-- doc-meta: owner=eng | last-reviewed=2026-07-14 -->

Add Skeleton to a repo in six steps. Flag details: [install](install.md). Every config key: [config](config.md).

## 1. Install and init

```bash
npm install -D @csark0812/skeleton
npx skeleton init --skills
```

Init writes `.skeleton/`, merges IDE customize hooks, and adds `validate:changed` / `validate:ci` scripts to `package.json`.

## 2. Set the scan perimeter

Open `.skeleton/config.yaml` and define what Skeleton should scan.

### Toolbox / docs-only repo

```yaml
# yaml-language-server: $schema=node_modules/@csark0812/skeleton/schemas/config.schema.json

scan:
  include:
    - "docs/**"
    - "README.md"
    - ".skeleton/registry.md"
    - "AGENTS.md"
  exclude:
    - "refs/**"
  banned: []
  retiredSkills: []

daysUntilStale: 180
```

### App repo with skills

```yaml
# yaml-language-server: $schema=node_modules/@csark0812/skeleton/schemas/config.schema.json

scan:
  include:
    - "docs/**"
    - "README.md"
    - "AGENTS.md"
    - ".skeleton/registry.md"
    - ".claude/skills/**"
  exclude:
    - "refs/**"
    - "**/_draft-*/**"
  banned:
    - "apps/**/*_ANALYSIS.md"
  retiredSkills: []

daysUntilStale: 180
```

Plugin-enabled example and more keys: [config](config.md).

## 3. Write a canonical doc

Create a file with a banner and (for index / registry-listed docs) doc-meta:

```markdown
# API conventions

**Source of truth for** Backend API conventions.

<!-- doc-meta: owner=eng | last-reviewed=2026-07-14 -->

Keep request and response shapes consistent across services.
```

## 4. Register it

```bash
npx skeleton register docs/developer/api.md
```

Adds a row to `.skeleton/registry.md`. Use `register` — don't hand-edit the table.

## 5. Verify

```bash
npx skeleton audit self
npx skeleton validate changed --staged
```

Audits pass → you're set. Stale `last-reviewed` warnings are OK until you bump dates. Failures → [troubleshooting](troubleshooting.md).

## 6. Optional pre-commit

```bash
pre-commit install
```

Hook configs typically run `skeleton validate changed --staged`. Details: [install](install.md).

## Day-one checklist

- [ ] `npm install -D @csark0812/skeleton`
- [ ] `npx skeleton init --skills`
- [ ] Edit `.skeleton/config.yaml` scan trees
- [ ] Write a canonical doc with banner (+ doc-meta if registered)
- [ ] `npx skeleton register <path>`
- [ ] `npx skeleton audit self`
- [ ] (Optional) `pre-commit install`

## Next

| Goal                                          | Doc                                   |
| --------------------------------------------- | ------------------------------------- |
| Config keys and examples                      | [config](config.md)                   |
| What to run after a change                    | [validation](validation.md)           |
| Banner / registry / doc-meta                  | [doc system](doc-system.md)           |
| Skill overrides without editing synced skills | [customize](customize.md)             |
| Product-specific audit rules                  | [plugins](plugins.md)                 |
| Common failures                               | [troubleshooting](troubleshooting.md) |
