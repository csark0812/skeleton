# Agent entry (skeleton)

<!-- source-of-truth: agent cold-start in this repo -->

<!-- doc-meta: owner=eng -->

<!-- review-deps: paths=src/cli.ts,package.json#scripts,package.json#bin,package.json#engines,package.json#packageManager,package.json#name -->

SSOT audit CLI (`@csark0812/skeleton`). Not an app. Prefer `bun src/cli.ts`.

## Route first

Run `bun src/cli.ts route` for the lane card.
Run `bun src/cli.ts route <path>` to classify one path.
Then run the printed command. Do not open developer docs to pick a lane.

After a full re-read, attest only that path:

```bash
bun src/cli.ts attest docs/a.md
```

Commit the edit first: a review records committed bytes. If the text did not need to change but a dependency did, add `--reason "<what you checked>"`; attestation refuses a bare stamp in that case and records the reason.

Attestation adds one empty commit whose message carries a `Skeleton-Reviewed:` line for that document. It changes no tracked file, so branches that review the same document never conflict. Keep commit messages when squash-merging, so the line reaches `main`.

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
