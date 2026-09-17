# Billing webhook delivery

The live endpoint is https://api.example.com/v1/billing/webhook.

Failed deliveries are not retried. The implementation is in `src/billing.ts`.
