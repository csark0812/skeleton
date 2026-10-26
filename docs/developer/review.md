# Code review

<!-- source-of-truth: harness-neutral code review bundle, review guides, and human-review paths -->

<!-- doc-meta: owner=eng -->

<!-- review-deps: paths=src/review/**,src/cli.ts,src/validate/route.ts,src/audit/config/types.ts,schemas/config.schema.json -->

Skeleton prepares a code review; it does not perform one. `skeleton review prepare` collects everything a reviewer with fresh context needs into one plain-text bundle. Any agent harness, CI step, or person can then run the review. Skeleton runs no language model, posts no PR comments, and approves nothing.

```bash
skeleton review prepare                    # working tree against HEAD, plus untracked files
skeleton review prepare --staged           # the index
skeleton review prepare --base origin/main # a branch range
skeleton review prepare --base origin/main --json
skeleton review prepare --base origin/main --run   # pipe the bundle to [review] command
```

## The bundle

The bundle has these sections, in order:

1. **Reviewer contract.** The output format and rules. Each finding is one line: `<severity>\t<file>:<line>\t<bug class>\t<what breaks and why>`. The severities are `important` (must be fixed before merge), `nit` (optional), and `pre-existing` (not introduced by this diff; never blocks the author). The reviewer cites exact lines, names the bug class so the author can fix every instance, reports style only when a review guide asks for it, and does not re-report resolved findings. It ends with a count line, or `no issues`.
2. **Human review required.** Shown only when a changed path, including a deleted one, matches `[review] humanPaths`. An agent review does not count for them. The same list is printed on stderr.
3. **Documents the author must re-read and attest.** Impacted documents (other than `REVIEW.md` guides) whose review proof fails, with the changed paths that pulled them in. Deleted paths are not considered. A legacy, conflicted, or malformed proof file stops `review prepare` with an error; run `skeleton audit docs --fix=review-proof` first.
4. **Review guides.** Every scanned `REVIEW.md` whose `review-deps` match a changed path, plus every `REVIEW.md` that declares no `review-deps`.
5. **AGENTS.md** from the repository root.
6. **The diff** for the selected scope, in a fence longer than any backtick run it contains. A plugin that fails to load stops `review prepare` with an error rather than producing an incomplete bundle.

`--json` prints the same data as one object (`ReviewBundle` in `src/review/prepare.ts`). `--run` cannot be combined with `--json`.

## Review guides

A `REVIEW.md` tells a reviewer what matters in one area of the code. Put it inside the scan perimeter and scope it with `review-deps`:

```markdown
# Billing review

<!-- review-deps: paths=src/billing/** -->

- Failure means a customer is charged twice or not at all. Flag any retry that is not idempotent.
- Ignore generated files under src/billing/generated/.
- Do not comment on naming or formatting.
```

Keep a guide short: what failure means in this area, paths to ignore, and what not to nitpick. When a reviewer keeps raising the same finding, fix it at the source: a lint rule or plugin policy, the guide, or the owning document. Do not just answer it again on each PR.

## Human-review paths

```toml
[review]
humanPaths = [".github/workflows/**", "src/auth/**", "src/billing/**", "scripts/release/**"]
command = "./scripts/review-agent.sh"   # optional: any command that reads the bundle on stdin
```

The risk tier comes from the changed paths, never from who wrote the change. A change that touches no human path can merge with an agent review and green checks. A change that touches one needs a person. `review prepare` names those paths; enforce the requirement with CODEOWNERS and branch protection, because only the forge can tell whether a person approved.

## Converging

Review must converge. An agent author and an agent reviewer can otherwise cycle without end. The packaged skill tells agents to:

- run at most three review cycles, then stop and ask a person to re-evaluate the approach;
- after the first cycle, review only the new diff (`--base` set to the last reviewed commit);
- fix a named bug class completely, not one line;
- not re-report a finding that was fixed or resolved with a reason.

## Not in scope

These belong to the agent harness, the forge, or CI, not to Skeleton: running the reviewer model, voting on or filtering findings, PR threads and their resolution, CODEOWNERS and branch protection, merge queues, feature flags, staged rollout, and revert tooling.
