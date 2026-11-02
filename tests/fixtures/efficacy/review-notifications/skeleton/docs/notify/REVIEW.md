# Notifications review

<!-- review-deps: paths=src/notify/** -->

- Every path that sends a message must call `require_opt_in` first. Failure means a user who never opted in receives messages.
- Do not comment on naming or formatting.
