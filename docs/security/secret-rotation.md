# Emergency Secret Rotation Runbook

## Scope
This runbook covers emergency rotation for:
- GitHub personal access tokens (PATs)
- Vercel API / project secrets
- Supabase project credentials (`anon`, `service_role`, JWT signing secret)
- Deployment environments (Vercel, CI/CD, local `.env`)

> Incident target project: `rujwuruuosffcxazymit`.

## 1) Immediate Containment (T+0 to T+15 min)
1. Freeze deployments and announce incident in team channel.
2. Revoke all exposed tokens immediately in each provider dashboard.
3. Invalidate active sessions where provider supports it.
4. Capture evidence: timestamp, scope of exposure, affected branches/commits.

## 2) GitHub PAT Rotation
1. Go to GitHub **Settings → Developer settings → Personal access tokens**.
2. Revoke each exposed PAT.
3. Create replacement tokens with minimum scopes only:
   - `repo:status` / `repo_deployment` / `contents:read|write` only if required.
   - Prefer fine-grained PATs restricted to specific repos.
4. Update GitHub Actions secrets in each repository.
5. Validate by running a read-only API call or repository checkout.

## 3) Vercel Token + Project Credential Rotation
1. In Vercel dashboard, revoke exposed API token(s).
2. Create replacement token with least privilege and shortest practical expiry.
3. Rebind project/org credentials for project ID `prj_m4tXQKdhxlC6AptqG4CLfaCkzAkM`.
4. Update Vercel environment variables for all environments:
   - Production
   - Preview
   - Development
5. Trigger a preview deployment and confirm health checks pass.

## 4) Supabase Credential Rotation (`rujwuruuosffcxazymit`)
1. Open Supabase project settings for API/JWT.
2. Rotate credentials in this order:
   - `service_role`
   - `anon`
   - JWT signing secret
3. Regenerate JWT-derived keys after signing-secret rotation.
4. Invalidate previous credentials where possible:
   - Replace all stored copies in CI, Vercel, and local developer machines.
   - Restart services and redeploy to flush cached secrets.
5. Run smoke tests on auth-required and public endpoints.

## 5) Update All Environments
Update rotated values in:
- GitHub Actions secrets (repo/org level)
- Vercel environment variables
- Local `.env` files (developers + CI runners)

Then:
1. Redeploy backend and frontend.
2. Restart workers and background jobs.
3. Confirm no process is still using revoked credentials.

## 6) Verification Checklist
- [ ] `www` and apex domains serve the same app and pass smoke tests.
- [ ] API auth endpoints succeed with new keys and fail with old keys.
- [ ] CI pipelines pass with rotated secrets.
- [ ] Secret scan passes in CI (`Secret Scan` workflow).
- [ ] Audit logs confirm no usage of revoked credentials after rotation time.

## 7) Rollback Strategy
If outage risk is high:
1. Keep old credentials valid only during a short overlap window.
2. Roll forward by fixing misconfigured env vars.
3. End overlap by revoking old credentials definitively.

## 8) Post-Incident Hardening
1. Enforce branch protection and required `Secret Scan` check.
2. Enable local pre-commit hooks:
   ```bash
   git config core.hooksPath .githooks
   ```
3. Add periodic secret rotation cadence (e.g., every 90 days).
4. Minimize token scope and lifetime for all providers.
5. Document incident RCA and remediation timeline.
