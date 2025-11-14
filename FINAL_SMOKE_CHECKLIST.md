# Smoke Test Checklist (Post-Deploy)

1. CI workflow succeeded (deploy-supabase.yml).
2. Functions list contains api-router and events-stream.
3. Health:
   curl -sS https://<PROJECT_REF>.functions.supabase.co/api-router/api/v1/status | jq .
   Expect JSON { success: true, status: "healthy" }
4. Patient login test:
   curl -sS -X POST https://<PROJECT_REF>.functions.supabase.co/api-router/api/v1/patient/login \
     -H "Content-Type: application/json" \
     -d '{"patientId":"12345678","gender":"male"}' | jq .
   Expect JSON (success or structured error) — never blank.
5. Logs show [diag] patient/login line including body.
6. No secrets committed (grep -R SUPABASE_ACCESS_TOKEN).
7. Frontend Network tab shows JSON for login request.
