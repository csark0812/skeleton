# Agent entry

Inspect the repository before answering. Treat source code as live behavior.
Keep the focused tests and the relevant documentation accurate when changing code.

<!-- skeleton: context-guide -->
## Skeleton context

Make `npx --no-install skeleton context "<topic>"` the first repository command. Use `--path` only for a known implementation path and `--staged` for staged-code questions. Returned document, source, and test excerpts are already read; do not read those files again. Complete every `action` line and verify it against the final files. Preserve existing work. If a test is returned, edit and run only that test. Otherwise use one combined command to find and read the focused test. Stop when it passes. Do not run Skeleton audits, validation, or review-proof commands unless the user requested them or the focused test fails. Broader discovery or another context command is reserved for `no-context`, omitted evidence, or a failing focused test.
