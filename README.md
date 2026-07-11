# skeleton

Public starter template for Cursor/Claude agent skills.

Copy this repo (or install the example skill) when creating a new skill package.

## Install the example

```bash
npx skills add csark0812/skeleton --skill skill -g --agent cursor claude-code -y
npx skills update -g
```

## Create a new skill repo from this template

1. Duplicate this repo (or copy the `skill/` directory into your repo).
2. Rename `skill/` to your skill slug (e.g. `my-skill/`).
3. Edit `SKILL.md` frontmatter: set `name` and `description`.
4. Replace placeholder content in `SKILL.md` and `references/`.
5. Add optional source material under `refs/` (keep distilled rules in the skill body).
6. Push and install:

```bash
npx skills add <owner>/<repo> --skill <slug> -g --agent cursor claude-code -y
```

## Layout

```
skeleton/
  skill/                 # rename to your slug
    SKILL.md
    references/          # skill-local reference docs
  refs/                  # optional source material (not installed by npx skills)
  docs/authoring.md      # conventions and checklist
```

## Related repos

| Repo | Purpose |
|------|---------|
| [toolbox](https://github.com/csark0812/toolbox) | Public team skills |
| [personal-toolbox](https://github.com/csark0812/personal-toolbox) | Private personal skills |
| **skeleton** | Public template for new skills |
