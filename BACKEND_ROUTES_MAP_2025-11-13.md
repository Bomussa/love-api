# MMC‑MMS Backend Routes Map (api-router)

This reference maps handlers to HTTP routes for `/api/v1/*`.

## Patient & Sessions
- POST `/api/v1/patient/login` → `handlePatientLogin`

## Queue Flow
- POST `/api/v1/queue/enter` → `handleQueueEnter`
- GET  `/api/v1/queue/position` (clinic,user) → `handleQueuePosition`
- GET  `/api/v1/queue/status` (clinic) → `handleQueueStatus`
- POST `/api/v1/queue/call` → `handleQueueCall`
- POST `/api/v1/queue/done` → `handleQueueDone`
- POST `/api/v1/clinic/exit` → `handleClinicExit`

## PIN
- GET  `/api/v1/pin/status` (clinic) → `handlePinStatus` (masked)
- GET  `/api/v1/admin/pin/status` (clinic) → `handleAdminPinStatus`

## Stats
- GET  `/api/v1/stats/dashboard` → `handleStatsDashboard`
- GET  `/api/v1/stats/queues` → `handleStatsQueues`

## Dynamic Routes
- POST `/api/v1/routes` → `handleRouteCreate`
- GET  `/api/v1/routes/:id` → `handleRouteGet`
- POST `/api/v1/path/choose` → `handlePathChoose`

## Internals & Helpers
- `getQueueTable`, `clinicCol`, `resolveClinicKey`, `nextQueuePosition`, `countWaiting`, `fetchQueueEntries`, `queuePositionPayload`, `ensureValidPin`, `fetchTodaysPin`, `getSessionById`, `ensurePatient`, `createSession`.

## Table Detection Rules
- Prefers singular `queue` (with `clinic_id` UUID) then falls back to plural `queues` (with `clinic` string).
- When using `queue`, convert clinic text (e.g., `xray`) to UUID via `resolveClinicKey()`.
- Do not select `queue_number` when operating on singular `queue`.
