# Billing

<!-- source-of-truth: Charge retry policy -->

<!-- doc-meta: owner=billing -->

<!-- review-deps: paths=src/billing/charge.ts -->

Failed charges are retried once. Charges go through `chargeInvoice` in `src/billing/charge.ts`.
