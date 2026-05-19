# DB Source of Truth

## Authoritative migration path
The **only** authoritative source for production database deployment is:

- `supabase/migrations/`

The following locations are archived and **must not** be used for production deploys:

- `legacy/migrations/`
- `legacy/supabase/schema.sql`

## Production-authorized chain
Production deploys must execute only files listed in:

- `supabase/migrations/PRODUCTION_CHAIN.txt`

Rules:
1. Deployment pipelines must fail if they find a migration file under `supabase/migrations/` that is not listed in `PRODUCTION_CHAIN.txt`.
2. Legacy files are excluded from deployment scope by policy.
3. Any new migration must update `PRODUCTION_CHAIN.txt` in the same PR.

## Allowed execution order
`PRODUCTION_CHAIN.txt` order is the contract. Do not reorder historical entries. Append only.

## Normalization guard
Migration `20260519120000_normalization_guard.sql` is a fail-fast contract gate.
It verifies required tables/columns/RLS/policies are present and aborts execution if drift is detected.

## Rollback matrix (critical migrations)
| Migration | Purpose | Forward compatibility | Backward compatibility / rollback |
|---|---|---|---|
| `20260316090000_canonicalize_queues.sql` | Canonical queue normalization | Keep legacy readers using compatibility views/columns while writing canonical shape | Roll back by restoring previous queue projections/views and keeping writes dual-compatible during rollback window |
| `20260316100000_queue_status_lifecycle_enforcement.sql` | Enforce queue lifecycle states | Accept old callers by mapping legacy statuses to canonical states | Revert lifecycle constraints/triggers first, then redeploy API mapping layer |
| `20260509004000_notifications_core.sql` | Notifications base model | New nullable/compat columns preserve readers | Roll back by retaining added columns and disabling new writes before schema contraction |
| `20260509004500_system_settings_contract.sql` | System settings contract hardening | Keep defaults to avoid breaking older callers | Roll back by reintroducing removed defaults/constraints before app rollback |
| `20260510120000_queue_atomic_insert_and_display_uniqueness.sql` | Atomic queue insert + uniqueness | New RPC is additive and should coexist with old endpoint contract during cutover | Roll back by switching API to previous RPC and removing uniqueness constraint only after dedup fix |
| `20260519120000_normalization_guard.sql` | Drift detection gate | Non-destructive checks only | Safe rollback: remove guard migration from chain if emergency bypass is required |

## Change protocol
For every schema PR:
1. Add migration in `supabase/migrations/`.
2. Append it to `PRODUCTION_CHAIN.txt`.
3. Add/adjust rollback note in this file.
4. Pass static migration CI guards.
