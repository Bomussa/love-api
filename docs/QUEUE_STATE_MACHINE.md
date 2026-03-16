# Queue State Machine (Official)

## Canonical path

`waiting -> called -> in_service -> completed`

Only these states are valid in `public.queues.status`.

## Transition rules

- `waiting -> called`: patient is announced.
- `called -> in_service`: examination starts.
- `in_service -> completed`: examination finished.

Direct jumps are invalid (for example `waiting -> in_service`, `called -> completed`).

## Legacy value mapping

Legacy values are mapped during migration before constraints are enforced:

- `serving` -> `in_service`
- `in_progress` -> `in_service`
- `done` -> `completed`
- `skipped` -> `completed`

## Enforcement

- DB `CHECK` constraint restricts valid state values.
- Trigger `trg_assert_queue_status_transition` rejects invalid transitions.
- Edge functions use guards to reject invalid application-level status writes.
