# MMC-MMS API - Medical Committee Backend (Supabase)

Backend API for the Military Medical Committee System using Supabase Edge Functions.

## Architecture

- **Platform**: Supabase Edge Functions (Deno runtime)
- **Database**: PostgreSQL + PostgREST
- **Real-time**: Supabase Realtime subscriptions
- **Cron Jobs**: pg_cron for scheduled tasks
- **CORS**: Handled in Edge Functions

## Deployment

This project is deployed on Supabase **only** - NOT on Vercel.

## Setup

### Prerequisites
```bash
npm install -g supabase
```

### Link to Supabase Project
```bash
supabase login
supabase link --project-ref YOUR-PROJECT-REF
```

### Deploy Functions
```bash
supabase functions deploy api-v1-status
```

### Run Migrations
```bash
supabase db push
```

## Edge Functions

- `api-v1-status` - Health check with CORS support

## Database Tables (Realtime Enabled)

- `queues` - Active patient queues
- `queue_history` - Historical queue data
- `notifications` - System notifications
- `pins` - Daily clinic PINs

## Environment Variables (Supabase Secrets)

Set in Supabase Dashboard → Project Settings → API → Secrets:

```bash
# Example service role key storage
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
```

## Local Development

```bash
supabase start
supabase functions serve
```

## Endpoints

Base URL: `https://YOUR-PROJECT-REF.functions.supabase.co/`

- `GET /api-v1-status` - Health check
- More functions to be added...

## CORS Configuration

All Edge Functions include CORS headers for cross-origin requests from the frontend.

## Scheduled Tasks

Cron jobs are managed via pg_cron extension:

- Daily maintenance at 05:00 UTC
- Custom schedules as needed

