# Agent entry

Inspect the repository before answering. Cite the documents you use.

<!-- skeleton: context-guide -->
## Skeleton context

Make `npx --no-install skeleton context "<topic>"` the first repository command. Use `--path` only for a known implementation path and `--staged` for staged-code questions. Never combine a topic with `--path`. Returned document, source, and test excerpts are already read; do not read those files again unless an action requires a complete review. A `whole-file` excerpt is the entire file. `reference` lines list every tracked file and line naming an identifier from the request; for a rename or removal, change exactly those lines without searching again. Do not rerun context or search, list, or read returned paths when the packet contains a document, source, and test and has no relevant review gap or omitted evidence; edit directly from that packet. Complete every `action` line and verify it against the final files. Preserve existing work. For read-only work, answer immediately when the returned evidence fully answers a read-only request. Do not run repository-wide searches, file listings, or status checks to reconfirm a complete result. For changes: If a test is returned, make the edits and run only the returned `test-command` once without progress narration between the edits and test. Stop when it passes. Inspect again only when that test fails, and inspect only the failure-specific region. Otherwise use one combined command to find and read the focused test. Do not run Skeleton audits or validation unless the user requested them or the focused test fails.

A packet with review actions or omitted evidence is incomplete. Resolve relevant gaps before relying on active implementation claims. Preserve historical alternatives and future aspirations as qualified intent. A `current` status means the declared sources are unchanged, not that the document agrees with them. Source changes need declared `review-deps` and source-triggered validation in the consumer.

When context returns `no-context`, inspect code, tests, and nearby docs to find the canonical owner. Repair an existing owner's summary, content, or `review-deps`; create an owner only for durable features, policies, workflows, or architectural contracts. Include a `source-of-truth` summary and appropriate `review-deps`; a `--path` miss needs an owning document. For read-only tasks, report the gap and proposed follow-up without editing. Skip one-off debugging details and transient implementation facts. Rerun the exact context request until it returns the owner.

Before opening a pull request, run `npx --no-install skeleton review prepare --base <base branch>` and follow its reviewer contract; stop on any human-review path.
