# API Router Authorization Behavior: Before vs After

## Scope
Comparison for the same request shapes on `supabase/functions/api-router`.

## Requests Compared

### 1) Happy path: client sends Authorization
- Request: `GET /api/v1/admin/status` with `Authorization: Bearer <client_jwt>`

### 2) Unauthorized path: admin endpoint without Authorization/internal key
- Request: `GET /api/v1/admin/status` without `Authorization` and without `x-internal-api-key`

## Behavioral Diff

| Scenario | Before | After |
|---|---|---|
| Happy path with client `Authorization` | Router forwarded client header to downstream function. | **No change**: router still forwards client `Authorization` as-is. |
| Unauthorized path (no `Authorization`, no internal key) on allowlisted admin backend function | Router generated `401 Unauthorized internal request` for service-role escalation attempt. | **No change**: router still returns `401 Unauthorized internal request`. |
| Non-allowlisted endpoint without `Authorization` | Router removed `Authorization` and forwarded request without service role. | **No change**: same behavior. |

## Security Contract Confirmation
- No global service-role enforcement exists for all routes.
- Client `Authorization` is now resolved via explicit auth resolution path and passed through unchanged.
- Service-role is applied only for narrow allowlist + valid `x-internal-api-key` match.
- Unauthorized internal escalation still returns a stable 401 JSON contract.
