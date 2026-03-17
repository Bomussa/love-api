# Vercel Environment Variables Setup

## Required Environment Variables for Vercel

To deploy the `love-api` project on Vercel, you need to set the following environment variables in your Vercel project settings:

### 1. Supabase Configuration

```
SUPABASE_URL=https://rujwuruuosffcxazymit.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<set-in-vercel-environment>  # required
```

### 2. API Configuration (Optional)

```
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

## Steps to Set Environment Variables on Vercel

1. Go to your Vercel project dashboard
2. Click on "Settings"
3. Navigate to "Environment Variables"
4. Add each variable with its corresponding value
5. Make sure to select the appropriate environments (Production, Preview, Development)
6. Click "Save"
7. Redeploy your project to apply the changes

## Verification

After setting the environment variables, you can verify they are correctly set by:

1. Accessing the health endpoint: `https://your-vercel-domain.vercel.app/api/v1/health`
2. Running the deep QA check: `https://your-vercel-domain.vercel.app/api/v1/qa/deep_run`

Both endpoints should return successful responses if SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are correctly configured.

## Important Notes

- Never commit sensitive keys to your repository
- Use `.env.example` as a template for developers
- Rotate keys periodically for security
- Keep the Supabase service role key secure and never expose it in client-side code
- If a key was exposed in Git history, rotate it immediately before redeploying
