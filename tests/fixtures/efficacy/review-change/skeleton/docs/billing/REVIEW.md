# Billing review

<!-- review-deps: paths=src/billing/** -->

- Every path that charges a card must call `requireManualApproval` first. Failure means an unapproved large charge reaches the card network.
- Do not comment on naming or formatting.
