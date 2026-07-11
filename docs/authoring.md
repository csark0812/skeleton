# Authoring checklist

## SKILL.md frontmatter

Required:

```yaml
---
name: my-skill          # slug; matches directory name
description: One sentence for agent routing — when to use, when not to.
---
```

Optional:

- `disable-model-invocation: true` — user-invoked only
- `metadata.internal: true` — hide from default discovery (private repos usually skip this)

## Directory layout

```
my-repo/
  my-skill/
    SKILL.md
    references/       # travels with the skill
  refs/               # repo-only source material (optional)
  README.md
```

## Description quality

Good descriptions include:

- What the skill does
- When to use it
- When **not** to use it (point to other skills if relevant)

Bad: "Helps with stuff." Too vague for routing.

## Distribution

| Scope | Command |
|-------|---------|
| Global (your machine) | `npx skills add owner/repo --skill slug -g -y` |
| Project (team) | `npx skills add owner/repo --skill slug -y` |
| Update | `npx skills update -g` or `npx skills update -p` |

Shorthand: `owner/repo` maps to `github.com/owner/repo`. The `@` prefix is **not** supported.

## Repo tiers (this monorepo)

| Repo | Visibility | Use |
|------|------------|-----|
| toolbox | public | Shared team skills |
| personal-toolbox | private | Personal skills |
| skeleton | public | Template for new skills |
