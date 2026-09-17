# Billing webhook idempotency contract

<!-- source-of-truth: Billing webhook idempotency contract; source owner src/billing/idempotency.ts -->

<!-- doc-meta: owner=eng | last-reviewed=2026-09-14 -->

<!-- review-deps: paths=src/billing/idempotency.ts -->

Every delivery uses the Idempotency-Key header. The implementation owner is src/billing/idempotency.ts.
