# Final Smoke Test Checklist

This document describes the smoke tests to verify the patient login functionality and CI deployment workflow.

## Pre-Deployment Checks

- [ ] Verify `.github/workflows/deploy-supabase.yml` uses `${{ secrets.SUPABASE_PROJECT_REF }}`
- [ ] Verify workflow working-directory is set to `supabase`
- [ ] Verify no hardcoded secrets in repository
- [ ] Check that `.env.example` contains placeholder values only

## API Endpoint Smoke Tests

### 1. Health Check
```bash
curl -X GET https://YOUR_PROJECT.supabase.co/functions/v1/api-router?path=status
```
Expected: 
- Status code: 200
- Response contains: `{"success":true,"status":"healthy"}`

### 2. Patient Login - Valid Request
```bash
curl -X POST https://YOUR_PROJECT.supabase.co/functions/v1/api-router?path=patient/login \
  -H "Content-Type: application/json" \
  -d '{"patientId":"123456","gender":"male"}'
```
Expected:
- Status code: 200
- Response contains: `{"success":true,"data":{...}}`
- Response includes session ID and patient data
- Console logs show diagnostic output `[DIAG patient/login]`

### 3. Patient Login - Missing patientId
```bash
curl -X POST https://YOUR_PROJECT.supabase.co/functions/v1/api-router?path=patient/login \
  -H "Content-Type: application/json" \
  -d '{"gender":"male"}'
```
Expected:
- Status code: 400
- Response contains: `{"success":false,"error":"patientId is required"}`
- **No blank/empty response** (diagnostic wrapper ensures structured JSON)

### 4. Patient Login - Invalid JSON
```bash
curl -X POST https://YOUR_PROJECT.supabase.co/functions/v1/api-router?path=patient/login \
  -H "Content-Type: application/json" \
  -d 'invalid json'
```
Expected:
- Status code: 400 or 500
- Response contains structured JSON with error message
- **No blank/empty response**

### 5. Patient Login - Empty Body
```bash
curl -X POST https://YOUR_PROJECT.supabase.co/functions/v1/api-router?path=patient/login \
  -H "Content-Type: application/json" \
  -d '{}'
```
Expected:
- Status code: 400
- Response contains: `{"success":false,"error":"patientId is required"}`
- **No blank/empty response**

## CI/CD Workflow Smoke Tests

### 1. Verify Functions Deployment
After workflow completes:
- [ ] Check GitHub Actions logs for "Deploy api-router" step success
- [ ] Check GitHub Actions logs for "Deploy events-stream" step success
- [ ] Verify "Verify deployed functions (list)" step shows both functions

### 2. Verify Post-Deployment Checks
- [ ] Check that "Listing functions in project" shows api-router and events-stream
- [ ] Verify optional invoke step runs (or gracefully skips if not available)
- [ ] Confirm no deployment errors in logs

### 3. Manual Function Verification
```bash
# List deployed functions
supabase functions list --project-ref YOUR_PROJECT_REF

# Invoke health check
supabase functions invoke api-router --project-ref YOUR_PROJECT_REF \
  --body '{"path":"status"}'
```

## Diagnostic Logging Verification

Check Supabase function logs for diagnostic output:

1. Navigate to: Supabase Dashboard → Edge Functions → api-router → Logs
2. Trigger a patient login request
3. Verify logs contain:
   - `[DIAG patient/login]` entries with method, path, and body preview
   - No sensitive data (passwords, tokens) in logs
   - Request body length and preview (first 200 chars)

## Security Checks

- [ ] Verify no plaintext secrets in workflow file
- [ ] Confirm `SUPABASE_ACCESS_TOKEN` uses `${{ secrets.SUPABASE_ACCESS_TOKEN }}`
- [ ] Confirm `PROJECT_REF` uses `${{ secrets.SUPABASE_PROJECT_REF }}`
- [ ] Check that diagnostic logs don't expose sensitive patient data
- [ ] Verify request body preview is truncated (max 200 chars)

## Rollback Plan

If issues are detected:
1. Revert to previous version: `git revert <commit-sha>`
2. Redeploy functions manually or via workflow
3. Monitor function logs for errors
4. Re-run smoke tests to confirm rollback success

## Success Criteria

All tests pass when:
- ✅ All API endpoints return structured JSON responses (no blank screens)
- ✅ Diagnostic logging captures request details without exposing secrets
- ✅ CI/CD workflow deploys functions successfully
- ✅ Post-deployment verification shows both functions are active
- ✅ No hardcoded secrets in repository
- ✅ Error responses are always structured JSON with `success: false`
