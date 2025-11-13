# MMC‑MMS Backend Maintenance Guide (Supabase Edge)

This document is the canonical maintenance reference for the backend (Supabase Edge Functions) as of 2025‑11‑13. It maps files, functions, endpoints, schemas, and deployment/runbook steps to enable fast and safe future changes.

## Architecture
- Stack: Supabase (PostgREST + Realtime + Edge Functions on Deno).
- Functions:
  - api-router: REST router for all /api/v1/* endpoints (queues, stats, routes, pin, patient login, admin tools).
  - events-stream: SSE publisher for real-time updates consumed by frontend via a single EventSource.
  - generate-pins-cron: Daily PIN generation/rotation for clinics.
- Frontend integration: Vercel rewrites /api/v1/* to Supabase functions (see love/vercel.json).

## Repository Layout (backend)
- love-api/supabase/functions/api-router/index.ts: Main REST handler and helpers.
- love-api/supabase/functions/events-stream/index.ts: SSE handler.
- love-api/supabase/functions/generate-pins-cron/index.ts: Scheduled PIN generator.
- love-api/package.json: Function deps/scripts.

## Environment Variables
- SUPABASE_URL or SB_URL: Project URL.
- SUPABASE_SERVICE_ROLE_KEY or SB_SERVICE_ROLE_KEY: Service role (never expose to frontend).
- VERIFY_JWT: Disabled during current deployments (--no-verify-jwt used for router testing).

## HTTP Endpoints (api-router)
Base path: /api/v1

- POST /patient/login
  - Body: { patientId: string, gender?: "male"|"female" }
  - Returns: { success, data: { id: sessionId, patient:{ id,name,militaryId,gender }, ... } }

- POST /queue/enter
  - Body: { clinic: string, user: string, isAutoEntry?: boolean }  (user = sessionId)
  - Behavior: Inserts into queue (queues or queue), sets status waiting or in_progress.
  - Returns: { success, clinic, user, queue_id, number, display_number, ahead, total_waiting, estimated_wait_minutes, status }

- GET /queue/position?clinic=...&user=...
  - Returns: { success, clinic, user, display_number, ahead, total_waiting, estimated_wait_minutes, status, number? }

- POST /queue/call
  - Body: { clinic: string }
  - Picks earliest waiting, sets called, writes queue_history best-effort.
  - Returns: { success, calledPatient: { id, number?, patient? } }

- POST /queue/done
  - Body: { clinic: string, user: string, pin: string }
  - Validates PIN, marks latest active entry for patient as completed.

- POST /clinic/exit
  - Body: { clinic: string, user: string }
  - Marks active entry for patient as completed (no PIN). Intended for exit without completion scoring.

- GET /queue/status?clinic=...
  - Returns: normalized active list for clinic including currentServing and total_waiting.

- GET /pin/status?clinic=... (public — masked)
  - Returns: { success, clinic, info: { active, date, generatedAt, expiresAt } } (no pin value).

- GET /admin/pin/status?clinic=... (admin — reveals pin)
  - Returns: { success, clinic, info: { pin, active, date, generatedAt, expiresAt } }.

- GET /stats/dashboard
  - Returns totals and activity aggregates across clinics.

- GET /stats/queues
  - Returns per-clinic queue distribution (robust to singular/plural tables).

- Dynamic routes (authoring):
  - POST /routes → create route.
  - GET /routes/:id → fetch route.
  - POST /path/choose → choose dynamic path.

## Queue Table Auto-Detection
- Helper picks the table present in schema (prefers 'queue' then falls back to 'queues').
- Clinic column mapping:
  - 'queues' → clinic (text code like "xray").
  - 'queue' → clinic_id (UUID referencing clinics.id).
- Text clinic keys are resolved to UUID via resolveClinicKey() when table is singular.

## Function Index (api-router/index.ts)
High-level roles (ordered by dependency):
- getQueueTable(client) → 'queue' | 'queues' based on schema cache.
- clinicCol(table) → 'clinic' | 'clinic_id'.
- resolveClinicKey(client, table, clinic) → returns clinic (text) or its UUID.
- safeCount(client, from, filters) → exact count helper.
- getSessionById(client, sessionId) → fetches session.
- ensurePatient(client, militaryId, gender) → upsert patient.
- createSession(client, patientId) → creates patient session.
- nextQueuePosition(client, clinic) → latest position + 1.
- countWaiting(client, clinic) → count waiting.
- fetchQueueEntries(client, clinic, statuses) → normalized entries list.
- fetchTodaysPin(client, clinic) → masked pin info.
- ensureValidPin(client, clinic, value) → validates pin against today’s record.
- queuePositionPayload(client, clinic, patientId) → metrics for current patient.
- Handlers:
  - handlePatientLogin
  - handleQueueEnter
  - handleQueueStatus
  - handleQueuePosition
  - handleQueueDone
  - handleClinicExit
  - handleQueueCall
  - handlePinStatus
  - handleAdminPinStatus
  - handleStatsDashboard
  - handleStatsQueues
  - handleAdminStatus
  - handleReportsHistory
  - handleRouteCreate
  - handleRouteGet
  - handlePathChoose

## Recent Fixes (2025-11-13)
- Boot fix: declared clinicKey in handleQueueCall and removed duplicate declarations in nextQueuePosition.
- Singular table insert fix: handleQueueEnter now uses resolved clinicKey for clinic_id.
- All queue handlers respect dynamic table + clinic column mapping and avoid selecting queue_number when not present.

## Runbook
Deploy (PowerShell):
    cd love-api
    supabase functions deploy api-router --project-ref rujwuruuosffcxazymit --no-verify-jwt
    supabase functions deploy events-stream --project-ref rujwuruuosffcxazymit
    supabase functions deploy generate-pins-cron --project-ref rujwuruuosffcxazymit

Quick Live Test:
    node -e "(async()=>{const base='https://www.mmc-mms.com/api/v1';const h={'content-type':'application/json'};const l=await fetch(base+'/patient/login',{method:'POST',headers:h,body:JSON.stringify({patientId:'TESTFLOW2',gender:'male'})});const lj=await l.json().catch(()=>({}));const sid=lj?.data?.id;const e=await fetch(base+'/queue/enter',{method:'POST',headers:h,body:JSON.stringify({clinic:'xray',user:sid})});const p=await fetch(base+'/queue/position?clinic=xray&user='+encodeURIComponent(sid));const c=await fetch(base+'/queue/call',{method:'POST',headers:h,body:JSON.stringify({clinic:'xray'})});const admin=await fetch(base+'/admin/pin/status?clinic=xray');const aj=await admin.json().catch(()=>({}));const pin=aj?.info?.pin;const d=await fetch(base+'/queue/done',{method:'POST',headers:h,body:JSON.stringify({clinic:'xray',user:sid,pin})});console.log('login',l.status,lj?.data?.id);console.log('enter',e.status,await e.text());console.log('position',p.status,await p.text());console.log('call',c.status,await c.text());console.log('done',d.status,await d.text());})();"

Pitfalls:
- Do not request queue_number for singular table.
- Always resolve clinic → clinic_id UUID when using singular table.
- queue_history writes are best-effort; absence must not break flows.
- Maintain a single EventSource on the frontend.

Change Checklist:
- [ ] Update handler(s)
- [ ] Validate against both queue and queues
- [ ] Deploy to Supabase
- [ ] Smoke test endpoints live
- [ ] Update this guide if APIs change
