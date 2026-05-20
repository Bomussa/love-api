# Backend Architecture

```mermaid
flowchart TB
  PKG[package.json] --> V1[api/v1.js]
  V1 --> HANDLERS[lib/api-handlers.js]

  HANDLERS --> HELPERS[lib/helpers-enhanced.js]
  HANDLERS --> SUPA[lib/supabase-enhanced.js]
  HANDLERS --> AUTH[lib/admin-auth.js]
  HANDLERS --> ROUTING[lib/routing.js]
  HANDLERS --> REPORTS[lib/reports.js]
  HANDLERS --> DB[(Supabase PostgreSQL)]

  API_ROUTER[supabase/functions/api-router/index.ts] --> HANDLERS

  ADMIN_LOGIN[supabase/functions/admin-login/index.ts] --> AUTH
  PATIENT_LOGIN[supabase/functions/patient-login/index.ts] --> HANDLERS
  PIN_STATUS[supabase/functions/pin-status/index.ts] --> HANDLERS

  QUEUE_ENTER[supabase/functions/queue-enter/index.ts] --> DB
  QUEUE_CALL[supabase/functions/queue-call/index.ts] --> CALL_NEXT[call-next-patient]
  QUEUE_STATUS[supabase/functions/queue-status/index.ts] --> DB
```

## Runtime verification
- `api/v1.js` is the canonical Vercel HTTP entrypoint.
- `lib/api-handlers.js` contains the effective queue, auth, clinic, patient, and report orchestration logic.
- `queue-call/index.ts` is a compatibility wrapper forwarding to `call-next-patient`.
- `queue-status/index.ts` reads directly from canonical `public.queues`.
