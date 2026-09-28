# Agent entry

Inspect the repository before answering. Treat source code as live behavior.
Keep the focused tests and the relevant documentation accurate when changing code.

<!-- skeleton: context-guide -->
## Skeleton context

Make `npx --no-install skeleton context "<topic>"` the first repository command. Use `--path` only for a known implementation path and `--staged` for staged-code questions. Never combine a topic with `--path`. Returned document, source, and test excerpts are already read; do not read those files again merely to reconfirm them. Complete every `action` line and verify it against the final files. Preserve existing work. Check every requested fact or change against the returned evidence. A returned owner is not proof that the packet covers the whole request: when a required fact is absent, follow the named sources into their imports, adjacent package metadata, or focused tests until it is verified, and report any fact that remains unverified. Do not infer absent facts from a source-of-truth title. For read-only work, answer when the evidence fully answers the request. Do not run repository-wide searches, file listings, or status checks to reconfirm a complete result. For changes: If a test is returned, make the edits and run the returned `test-command`; otherwise find the focused test. Stop only when requested behavior and documentation obligations are covered and the focused test passes. Inspect failure-specific regions when a test fails. Do not run Skeleton audits, validation, or review-proof commands unless the user requested them or the focused test fails.

When context returns `no-context`, inspect code, tests, and nearby docs to find the canonical owner. Repair an existing owner's summary, content, or `review-deps`; create an owner only for durable features, policies, workflows, or architectural contracts. Include a `source-of-truth` summary and appropriate `review-deps`; a `--path` miss needs an owning document. For read-only tasks, report the gap and proposed follow-up without editing. Skip one-off debugging details and transient implementation facts. Rerun the exact context request until it returns the owner.
