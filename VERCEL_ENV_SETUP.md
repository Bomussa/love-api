# Vercel Environment Variables Setup

## Required Environment Variables for Vercel

To deploy the `love-api` project on Vercel, you must set the following variables in Project Settings → Environment Variables.

## Required variables in every environment

Set these in **Production**, **Preview**, and **Development**:

```bash
SUPABASE_URL=https://rujwuruuosffcxazymit.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<your-supabase-service-role-key>
```

> Runtime validation will fail fast if either `SUPABASE_URL` or `SUPABASE_SERVICE_ROLE_KEY` is missing.

## Optional variables (defaults are applied by the app)

```bash
API_TIMEOUT=30000
API_RETRY_ATTEMPTS=3
API_RETRY_DELAY=1000
CACHE_ENABLED=true
CACHE_TTL=300
MAINTENANCE_MODE=false
NODE_ENV=production
LOG_LEVEL=info
CORS_ORIGIN=*
FEATURE_SSE_ENABLED=true
FEATURE_ADAPTIVE_POLLING=true
FEATURE_CIRCUIT_BREAKER=true
```

## Environment mapping checklist

- **Production**
  - `SUPABASE_URL`: production Supabase project URL
  - `SUPABASE_SERVICE_ROLE_KEY`: production service role key
- **Preview**
  - `SUPABASE_URL`: preview/staging Supabase URL (or production if intentionally shared)
  - `SUPABASE_SERVICE_ROLE_KEY`: matching preview/staging service key
- **Development**
  - `SUPABASE_URL`: development/local Supabase URL
  - `SUPABASE_SERVICE_ROLE_KEY`: matching development service key

## Steps to Set Environment Variables on Vercel

1. Go to your Vercel project dashboard.
2. Click **Settings**.
3. Navigate to **Environment Variables**.
4. Add each variable with its value.
5. Select target environments (**Production**, **Preview**, **Development**).
6. Click **Save**.
7. Redeploy your project.

## Verification

After setting the variables:

1. Open health endpoint: `https://your-vercel-domain.vercel.app/api/v1/health`
2. Run deep QA endpoint: `https://your-vercel-domain.vercel.app/api/v1/qa/deep_run`

Both should return successful responses.

## Important Notes

- Never commit sensitive keys to the repository.
- Keep `SUPABASE_SERVICE_ROLE_KEY` secret and server-side only.
- Use `.env.example` as a local template.
- Rotate keys periodically or immediately if exposure is suspected.
