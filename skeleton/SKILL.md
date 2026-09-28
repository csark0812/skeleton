---
name: skeleton
description: Use Skeleton to find canonical repository context for questions or source changes, or to perform setup, configuration, auditing, review proof, and skill ownership.
---

# Skeleton

<!-- source-of-truth: maintaining a skeleton-enabled repo -->

<!-- doc-meta: owner=eng | last-reviewed=2026-09-28 -->

## Repository context

Make `npx --no-install skeleton context "<topic>"` the first repository command. Use `--path` only for a known implementation path and `--staged` for staged-code questions. Returned document, source, and test excerpts are already read; do not read those files again. Complete every `action` line and verify it against the final files. Preserve existing work. Check each requested fact or change against the packet before answering or editing. A returned owner is a starting point, not proof that the packet covers every requested facet: if a required fact is absent, follow the named source paths into their imports or adjacent package metadata and focused tests until it is verified; say when it remains unverified. Do not infer absent facts from a source-of-truth title. If a test is returned, edit and run that focused test; otherwise find the focused test. Stop only when the requested behavior and documentation obligations are covered and the test passes. Do not run Skeleton audits, validation, or review-proof commands unless the user requested them or the focused test fails. Broader discovery or another context command is justified by `no-context`, omitted evidence, a failing focused test, or a required fact missing from the packet.

## Source implementation work

For source work, use the returned source excerpt to identify the implementation seam, then locate the nearest focused test with a targeted search. Preserve existing work, make one consistent source/test/document change, then run the focused test after the final edit. Do not replace that final test with a broad audit or an intermediate completion claim.

Do not run Skeleton commands just because Skeleton is installed. They are not a substitute for the focused test.

## Skeleton operations

For setup, configuration, auditing, review proof, CLI details, or skill ownership, read [references/operations.md](references/operations.md). For a change to Skeleton configuration, run `npx --no-install skeleton route <path>` and then its printed validation command.
