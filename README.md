# MMC‑MMS API (Supabase Edge)

Backend for the Military Medical Committee System on Supabase Edge Functions.

## Overview

- Platform: Supabase Edge (Deno)
- Database: PostgreSQL + PostgREST
- Realtime: Supabase Realtime
- Functions: `api-router`, `events-stream`, `generate-pins-cron`
- Frontend integration: Vercel rewrites `/api/v1/*` to these functions

## Start Here (Docs)

- Maintenance guide: `MAINTENANCE_GUIDE_2025-11-13.md` (canonical)
- Backend routes map: `BACKEND_ROUTES_MAP_2025-11-13.md`

These supersede older notes/reports. Treat previous memos as historical only.

## Deployment (CLI)

```powershell
supabase login
supabase link --project-ref <PROJECT_REF>
supabase functions deploy api-router --project-ref <PROJECT_REF>
supabase functions deploy events-stream --project-ref <PROJECT_REF>
supabase functions deploy generate-pins-cron --project-ref <PROJECT_REF>
```

## Environment Variables (Secrets)

Set in Supabase → Settings → API → Secrets:

```text
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
```

## Endpoints (via api-router under /api/v1)

- Patient: `POST /patient/login`
- Queue: `POST /queue/enter`, `GET /queue/position`, `GET /queue/status`, `POST /queue/call`, `POST /queue/done`, `POST /clinic/exit`
- PIN: `GET /pin/status`, `GET /admin/pin/status`
- Stats: `GET /stats/dashboard`, `GET /stats/queues`
- Routes: `POST /routes`, `GET /routes/:id`, `POST /path/choose`

See `BACKEND_ROUTES_MAP_2025-11-13.md` for details.

## Notes

- Queue table auto-detection supports `queue` (clinic_id UUID) and `queues` (clinic text).
- PIN cron writes `pins.clinic_code` using clinic code/slug (fallback to id) to align with API.

