# Fixture sources

Readable trees used to build `skeleton-clean` / `skeleton-messy` seed patches under `../skeleton-*/fixtures/seeds/`.

| Tree | Role |
| ---- | ---- |
| `clean/docs/fixture/` | Registered Billing API SoT + legacy decoy |
| `clean/skill-trees/` | Bodies seeded into worktree `fixture-skills/` |
| `messy/docs/fixture/` | Conflicting SoT claims (no correct webhook) |
| `messy/skill-trees/` | Same skill bodies for messy arm |

Skill seeds land under `fixture-skills/` (not `.claude/skills/`) so `git add` in the harness can stage them — root `.claude/` is gitignored in this repo.
