# Agent entry (skeleton)

<!-- source-of-truth: agent cold-start in this repo -->

<!-- doc-meta: owner=eng -->

<!-- review-deps: paths=src/cli.ts,package.json -->

SSOT audit CLI (`@csark0812/skeleton`). Not an app. Prefer `bun src/cli.ts`.

## Route first

Run `bun src/cli.ts route` for the lane card.
Run `bun src/cli.ts route <path>` to classify one path.
Then run the printed command. Do not open developer docs to pick a lane.

After a full re-read, attest only that path:

```bash
bun src/cli.ts audit docs --paths=docs/a.md --fix=doc-meta --confirm-reviewed
```

Attestation writes one proof file per document under `.skeleton/reviews/` and writes no date into the document. Commit that file with the change. Proof files hold hashes only, so parallel PRs that review different documents do not conflict.

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

Pre-commit runs `bun src/cli.ts validate changed --staged`.
