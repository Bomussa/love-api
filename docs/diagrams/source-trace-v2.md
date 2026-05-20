# Source Trace

Verified against current backend runtime paths and the canonical queue contract.

## Canonical backend runtime
- `api/v1.js`
- `lib/api-handlers.js`
- `lib/helpers-enhanced.js`
- `lib/supabase-enhanced.js`
- `lib/admin-auth.js`
- `lib/routing.js`
- `lib/reports.js`
- `supabase/functions/api-router/index.ts`
- `supabase/functions/queue-engine/index.ts`
- `supabase/functions/queue-enter/index.ts`
- `supabase/functions/queue-call/index.ts`
- `supabase/functions/queue-status/index.ts`
- `supabase/functions/call-next-patient/index.ts`

## Database source of truth
- `public.queues` is the canonical queue table.
- `public.unified_queue` and `public.queue` remain legacy/compatibility surfaces only.
- `public.clinics`, `public.patients`, `public.routes`, `public.patient_routes`, `public.system_settings`, `public.settings`, `public.system_config`, `public.audit_log` are active supporting tables.

## Frontend-linked entry points
- `love/vercel.json`
- `frontend/src/main.jsx`
- `frontend/src/App.jsx`
- `frontend/src/lib/api-unified.js`
- `frontend/src/lib/supabase-client.js`

## Compatibility note
Any document or diagram that shows `api/lib/helpers.js`, `api/lib/storage.js`, or direct runtime dependency on `unified_queue` is stale unless explicitly labeled legacy.