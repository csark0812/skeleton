# Order limits

<!-- source-of-truth: Order limits -->
<!-- doc-meta: owner=eng | last-reviewed=2026-09-17 -->
<!-- review-deps: paths=src/limits.ts,src/checkout.ts -->

Standard orders allow 20 items. Regulated orders allow 5. Unrecognized categories allow 20. The implementation is in src/limits.ts and is exposed through src/checkout.ts.
