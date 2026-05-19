# MMC-MMS Backend (love-api)

Backend/API repository for the Military Medical Center queue and examination system.

## Production
- Frontend: https://mmc-mms.com
- Backend health: https://mmc-mms.com/api/health
- API base: https://mmc-mms.com/api/v1

## Current Verified Status
- `/api/health` → working on production.
- `/api/v1/status` → implemented.
- `/api/v1/health` → restored during this maintenance cycle.
- Vercel deployment active.
- Supabase integration active.

---

# Main Runtime Structure

## Core API
| Path | Purpose |
|---|---|
| `api/v1.js` | Main API routing and medical queue logic |
| `api/health.js` | Global health endpoint |
| `api/v1/status.js` | API v1 runtime status |
| `api/v1/health.js` | v1 health compatibility endpoint |
| `api/maintenance.js` | Maintenance status endpoint |

## Queue Runtime
| Path | Purpose |
|---|---|
| `supabase/functions/queue-engine/index.ts` | Queue engine runtime |
| `supabase/functions/queue-enter/index.ts` | Queue entry |
| `supabase/functions/queue-status/index.ts` | Queue live status |
| `supabase/functions/call-next-patient/index.ts` | Doctor next-patient calling |

## Integration Layer
| Path | Purpose |
|---|---|
| `lib/api.js` | Shared API helpers |
| `lib/api-adapter.js` | Compatibility layer |
| `lib/mms-core-api.js` | Core medical API services |
| `lib/enhanced-api.js` | Extended helper layer |

---

# User Journeys

## Patient Journey
1. Patient login.
2. PIN verification.
3. Queue entry.
4. Live waiting status.
5. Doctor call.
6. Clinic progression.
7. Final medical completion screen.

## Doctor Journey
1. Doctor login.
2. Open clinic dashboard.
3. Call next patient.
4. Start examination.
5. Advance patient to next clinic.
6. Complete clinic stage.

## Admin Journey
1. Admin login.
2. Queue monitoring.
3. Doctor management.
4. Clinic monitoring.
5. Daily statistics.
6. Reports and maintenance.

---

# Verified Issues Detected This Week

## Confirmed
- Partial migration between legacy queue tables and unified queue runtime.
- Some legacy endpoints still coexist with `/api/v1/*`.
- Old scripts contained hardcoded Supabase credentials.
- `/api/v1/health` was missing on production.

## Fixed
- Removed hardcoded credentials from backend scripts.
- Restored `/api/v1/health` endpoint.
- Improved Supabase diagnostics.
- Removed duplicated frontend wrappers from `love` repository.

---

# Important Docs
| File | Purpose |
|---|---|
| `docs/API_V1_ENDPOINTS.md` | Official frontend/backend API contract |
| `docs/TRUTH_TREE_LOVE_API.md` | Backend truth tree |
| `BACKEND_OPERATIONS_GUIDE.md` | Operational procedures |
| `VERCEL_ENV_SETUP.md` | Environment configuration |

---

# Important Notes
- Supabase is the intended source of truth.
- Legacy compatibility layers still exist.
- No frontend visual redesign was performed.
- Changes focused on stability, routing, safety, and queue consistency.
