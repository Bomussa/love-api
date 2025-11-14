# Deploy Supabase Edge Functions on Windows (PowerShell)

This guide deploys `api-router` and `events-stream` from this repo to your Supabase project using the Supabase CLI installed via Scoop.

Prerequisites

- Supabase project ref (e.g., `rujwuruuosffcxazymit`)
- Supabase account with access to the project
- Windows PowerShell

Install CLI (one-time)

```powershell
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
iwr -useb get.scoop.sh | iex
scoop install supabase
supabase --version
```

Authenticate

Option A: Browser login

```powershell
supabase login
```

Option B: Token login

- Create a PAT at <https://supabase.com/dashboard/account/tokens>

```powershell
$env:SUPABASE_ACCESS_TOKEN="<YOUR_TOKEN>"
```

Link project (run from repo root)

```powershell
cd "c:\Users\USER\OneDrive\Desktop\mmcmms2027\love-api\supabase"
supabase link --project-ref rujwuruuosffcxazymit
```

Deploy functions

```powershell
supabase functions deploy api-router --no-verify-jwt
supabase functions deploy events-stream --no-verify-jwt
supabase functions list
```

Verify from frontend (production)

```powershell
$env:API_BASE = "https://www.mmc-mms.com"
Invoke-WebRequest "$env:API_BASE/api/v1/status" -UseBasicParsing | Select-Object -ExpandProperty Content
Invoke-WebRequest "$env:API_BASE/api/v1/pin/status" -UseBasicParsing | Select-Object -ExpandProperty Content
```

CI/CD (GitHub Actions)

- Add these repository secrets:
  - `SUPABASE_ACCESS_TOKEN`: A Supabase PAT with project access
  - `SUPABASE_PROJECT_REF`: `rujwuruuosffcxazymit`
- Push to `master` or `fix/patient-login-military-id` to trigger `.github/workflows/deploy-supabase.yml`.

Post-deploy tests

```powershell
cd "c:\Users\USER\OneDrive\Desktop\mmcmms2027\love"
node final-integration-test.js
node test-5-patients.js
```

Expected: ≥98% pass rate after reliability build is deployed. If any failures persist, check `/api/v1/status` telemetry (breaker/cache) and open an issue with the failing test name.
