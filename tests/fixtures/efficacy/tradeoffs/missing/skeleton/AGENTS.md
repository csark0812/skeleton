# Agent entry

Inspect the repository. Keep behavior, tests, and related documentation accurate. Verify changes.

<!-- skeleton: context-guide -->
## Skeleton context

Make `npx --no-install skeleton context "<topic>"` the first repository command. Use `--path` only for a known implementation path and `--staged` for staged-code questions. Returned document, source, and test excerpts are already read; do not read those files again. Complete every `action` line and verify it against the final files. Preserve existing work. If a test is returned, edit and run only that test. Otherwise use one combined command to find and read the focused test. Stop when it passes. Do not run Skeleton audits, validation, or review-proof commands unless the user requested them or the focused test fails.

When context returns `no-context`, inspect code, tests, and nearby docs to find the canonical owner. Repair an existing owner's summary, content, or `review-deps`; create an owner only for durable features, policies, workflows, or architectural contracts. Include a `source-of-truth` summary and appropriate `review-deps`; a `--path` miss needs an owning document. For read-only tasks, report the gap and proposed follow-up without editing. Skip one-off debugging details and transient implementation facts. Rerun the exact context request until it returns the owner.
