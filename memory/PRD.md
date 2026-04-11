# PRD — MMC System Hard Reset

## Original Problem Statement
- Full hard reset for the medical committee system with one real data source, realtime-only behavior, no mock data, no PIN flow, fixed auth, unified API contract, and strict simplification of admin/doctor/queue flows without changing the core medical visual identity.
- User choices applied: full frontend+backend in one round, PIN removed completely, frontend cleanup first then backend cleanup, credentials used only at runtime.

## Architecture Decisions
- Frontend now uses a single real API client in `src/lib/api-unified.js` with Supabase realtime channel usage and no local/mock fallback.
- Admin, doctor, and patient flows were simplified into the allowed screens only.
- Backend handlers were adapted toward the live Supabase reality discovered during self-test: `queue` uses `clinic_id + position`, `patients` differs from local draft, `patient_routes` exists, and `activity_logs` is used for doctor audit/account reconstruction.
- Backend prefers `SUPABASE_SERVICE_ROLE_KEY` when available to avoid RLS-induced contract breakage.

## Implemented
- Removed active usage of PIN/theme/reports/maintenance/standalone notification/patient-management flows from the runtime UI.
- Rebuilt login flow for patient/admin/doctor with backend-backed admin and doctor auth.
- Rebuilt admin dashboard with only dashboard, queue management, and doctor management.
- Rebuilt doctor screen with current patient, waiting/completed/absent stats, and queue actions.
- Rebuilt patient screen as realtime/read-only journey tracking.
- Added/updated API handlers for admin login, doctor lifecycle, patient login, queue status, queue call, queue complete, absent, transfer, postpone, and VIP handling using real Supabase data.
- Local verification completed for: build success, admin login, doctor creation/login, patient login, queue call, complete, absent, transfer, postpone, VIP, and patient journey status through direct handler execution.

## Prioritized Backlog
### P0
- Align the public production URL with the updated `/api/v1/*` contract currently present in code.
- Re-run full contract regression against the public URL after the public environment is updated.

### P1
- Consolidate remaining legacy unused files if a second cleanup round is requested.
- Improve queue ordering visibility in admin clinic list for VIP/postponed metadata presentation.

### P2
- Add richer audit/history display inside the UI for staff and patient route tracing.

## Next Tasks
1. Point the public runtime to the current API implementation and rerun backend regression.
2. Validate the refreshed frontend against the updated public API.
3. If requested, perform a second cleanup pass on remaining legacy non-runtime files.
