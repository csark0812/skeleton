# Agent entry (skeleton)

<!-- source-of-truth: agent cold-start in this repo -->

<!-- doc-meta: owner=eng -->

<!-- review-deps: paths=src/cli.ts,package.json#scripts,package.json#bin,package.json#engines,package.json#packageManager,package.json#name -->

SSOT audit CLI (`@csark0812/skeleton`). Not an app. Prefer `bun src/cli.ts`.

## Route first

Run `bun src/cli.ts route` for the lane card.
Run `bun src/cli.ts route <path>` to classify one path.
Then run the printed command. Do not open developer docs to pick a lane.

When you change a file that a document lists in `review-deps`, re-read that document and update it in the same commit. Pre-commit blocks a commit that changes the dependency but not the document; nothing records reviews. If the document is still correct, commit once without that hook (`SKIP=<hook id> git commit …`).

## First hour

Bun `1.2.x`. Node ≥ 22. No runtime env vars.

```bash
bun install
bun run check
```

`bun run check` = lint + test + typecheck + build + audit:self.

## Open only on demand

| Task | File |
| ---- | ---- |
| Agent efficacy tests | [docs/developer/efficacy.md](docs/developer/efficacy.md) |
| Validation lanes | [docs/developer/validation.md](docs/developer/validation.md) |
| Failures | [docs/developer/troubleshooting.md](docs/developer/troubleshooting.md) |
| Day-one setup | [docs/developer/getting-started.md](docs/developer/getting-started.md) |
| Audit rules | [docs/developer/audit.md](docs/developer/audit.md) |
| Code review bundle | [docs/developer/review.md](docs/developer/review.md) |

Pre-commit runs `bun src/cli.ts validate changed --staged`.
