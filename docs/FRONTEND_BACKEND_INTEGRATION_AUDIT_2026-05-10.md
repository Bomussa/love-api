# Frontend/Backend Integration Audit (2026-05-10)

## Scope
- Frontend repo: `/workspace/love` (cloned from `Bomussa/love`).
- Backend repo: `/workspace/love-api`.
- Domain smoke targets:
  - `https://mmc-mms.com`
  - `https://www.mmc-mms.com`

## Endpoint-by-endpoint route mapping

### Frontend-declared API routes (`pages/api/v1/**`)
`/api/v1/admin`, `/api/v1/admin/status`, `/api/v1/clinic`, `/api/v1/clinic/exit`, `/api/v1/events`, `/api/v1/events/stream`, `/api/v1/path`, `/api/v1/path/choose`, `/api/v1/patient/login`, `/api/v1/pin/generate`, `/api/v1/pin/status`, `/api/v1/pin/verify`, `/api/v1/queue/call`, `/api/v1/queue/done`, `/api/v1/queue/enter`, `/api/v1/queue/status`, `/api/v1/reports/annual`, `/api/v1/reports/daily`, `/api/v1/reports/monthly`, `/api/v1/reports/weekly`, `/api/v1/route/create`, `/api/v1/route/get`, `/api/v1/stats/dashboard`, `/api/v1/stats/queues`, `/api/v1/status`.

### Backend-handled route literals (`love-api/lib/api-handlers.js`)
`/api/v1/admin/login`, `/api/v1/admin/pins`, `/api/v1/admin/reports/daily`, `/api/v1/admin/users`, `/api/v1/admins`, `/api/v1/clinics`, `/api/v1/health`, `/api/v1/patient/login`, `/api/v1/patients/login`, `/api/v1/pin/generate`, `/api/v1/pin/status`, `/api/v1/pin/validate`, `/api/v1/pin/verify`, `/api/v1/qa/deep_run`, `/api/v1/queue/call`, `/api/v1/queue/done`, `/api/v1/queue/enter`, `/api/v1/queue/status`, `/api/v1/routing/exam-route`, `/api/v1/settings`, `/api/v1/status`.

## JSON contract alignment status
- Queue/PIN/status contracts pass backend regression checks (`npm run test:contracts`).
- Added compatibility endpoints in backend to satisfy required probe contracts:
  - `GET /api/v1/health`
  - `GET /api/v1/admins` (admin bearer required)
  - `POST /api/v1/qa/deep_run`

## Mismatches identified
1. Frontend has several route surfaces not present in backend route literals (example: `/api/v1/clinic`, `/api/v1/events`, `/api/v1/reports/*`, `/api/v1/route/*`, `/api/v1/stats/queues`).
2. Backend has admin and QA routes not represented as frontend `pages/api/v1/*` files (example: `/api/v1/admin/login`, `/api/v1/admin/users`, `/api/v1/qa/deep_run`).
3. Production domain still returns `404` for `/api/v1/health` at test time, while `/api/health` and `/api/v1/status` return `200`; this indicates deployed runtime is behind repository state.

## Smoke/regression result (real domains)
- Home page payload parity between apex and `www`: **PASS** (same SHA-256 hash).
- `/api/health` apex vs `www`: **PASS** (`200` both).
- `/api/v1/status` apex vs `www`: **PASS** (`200` both).
- `/api/v1/health` apex vs `www`: **FAIL** (`404` currently).

## Unified repair plan (no visual/theme changes)
1. Deploy backend revision containing `/api/v1/health` compatibility route.
2. Re-run domain smoke tests and require `/api/v1/health` to be `200` before promotion.
3. Normalize frontend route consumption to backend canonical endpoints (prefer direct backend routes instead of stale local pages proxies).
4. Add CI gate: fail on any route contract mismatch or domain parity mismatch.
5. Keep all UI/CSS assets untouched (medical theme preserved); limit change set to API contract adapters and tests only.

## Risk and rollback
- Risk: existing clients relying on strict auth semantics for `/api/v1/admins`.
- Mitigation: keep endpoint read-only and token-protected.
- Rollback point: revert `lib/api-handlers.js` commit if deployment causes regression.
