# Internal Admin Functions Policy

This policy applies to the three administrative edge functions:
- `api-management`
- `db-policies-manager`
- `db-tables-manager`

## Operating Policy

These functions are **not public endpoints** and must be invoked only from trusted internal systems.

Execution is explicitly denied by default unless all required verification layers pass:
1. Administrative JWT role (`admin` or `service_role`).
2. Valid internal secret via `x-internal-secret` matching `INTERNAL_ADMIN_SECRET`.
3. Global internal enable flag `API_ENABLED=true`.
4. Admin membership validation in `admins` table.

If any layer is missing or invalid, the function must return a standardized deny response without exposing database internals.
