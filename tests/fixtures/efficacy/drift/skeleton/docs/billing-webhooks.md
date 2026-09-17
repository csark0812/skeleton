# Billing webhook delivery

<!-- source-of-truth: Billing webhook endpoint and retry policy -->

<!-- doc-meta: owner=billing | last-reviewed=2026-09-14 -->

<!-- review-deps: paths=src/billing.ts -->

The live endpoint is https://api.example.com/v1/billing/webhook.

Failed deliveries are not retried. The implementation is in `src/billing.ts`.
