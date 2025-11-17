# STEP C — Environment Variable Consistency Audit

**Date:** 2025-11-17  
**Repository:** Bomussa/love-api  
**Focus:** Environment Variables Validation  

---

## 1. Required Environment Variables

Based on code analysis, the following environment variables are required:

### Critical Variables (Required for API to function)

| Variable | Purpose | Used In | Status |
|----------|---------|---------|--------|
| `SUPABASE_URL` | Supabase project URL | `api/supabase-client.js` | ⚠️ Has fallback |
| `SUPABASE_ANON_KEY` | Supabase anonymous key | `api/supabase-client.js` | ⚠️ Has fallback |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase admin key | `api/supabase-client.js` | ❌ No fallback |

### Optional Variables (For enhanced functionality)

| Variable | Purpose | Used In | Status |
|----------|---------|---------|--------|
| `KV_REST_API_URL` | Vercel KV URL | `api/lib/storage.js` | ✅ Optional |
| `KV_REST_API_TOKEN` | Vercel KV token | `api/lib/storage.js` | ✅ Optional |
| `NODE_ENV` | Environment mode | General | ✅ Optional |

---

## 2. Current Hardcoded Values

### ⚠️ SECURITY ISSUE: Exposed Credentials

**File:** `api/supabase-client.js` (Lines 12-13)

```javascript
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://rujwuruuosffcxazymit.supabase.co';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...';
```

**Issues:**
1. ❌ **Hardcoded credentials in source code** - Security risk
2. ❌ **Anon key exposed in repository** - Should be in environment variables only
3. ⚠️ **Fallback values prevent detection of missing env vars** - Can cause silent failures

**Recommendation:**
- Remove hardcoded fallbacks for production
- Keep them only for development/testing
- Add proper error handling when env vars are missing

---

## 3. Environment Variable Sources

### Where to Set Variables

#### 3.1 Vercel Project Settings
**Location:** Vercel Dashboard → Project → Settings → Environment Variables

**Required Variables:**
```
SUPABASE_URL=https://rujwuruuosffcxazymit.supabase.co
SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
SUPABASE_SERVICE_ROLE_KEY=<service_role_key_here>
```

**Scope:** Production, Preview, Development

#### 3.2 GitHub Repository Secrets
**Location:** GitHub → Repository → Settings → Secrets and variables → Actions

**Purpose:** For CI/CD pipelines (if applicable)

**Not needed for this project** (Vercel handles deployment)

#### 3.3 Local Development (.env)
**File:** `.env` (gitignored)

```env
SUPABASE_URL=https://rujwuruuosffcxazymit.supabase.co
SUPABASE_ANON_KEY=your_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
```

---

## 4. Validation Results

### ✅ Created Files
1. **`.env.example`** - Template for required environment variables
2. **Documentation** - Clear variable descriptions

### ⚠️ Issues Found
1. **Hardcoded credentials** - Need to be removed or made conditional
2. **No validation** - Code doesn't check if required vars are set
3. **Silent failures** - Fallback values mask configuration errors

---

## 5. Recommended Fixes

### Fix 1: Add Environment Variable Validation

**Create:** `api/lib/env-validator.js`

```javascript
/**
 * Environment Variable Validator
 * Ensures all required variables are set before API starts
 */

export function validateEnv() {
  const required = [
    'SUPABASE_URL',
    'SUPABASE_ANON_KEY'
  ];

  const missing = required.filter(key => !process.env[key]);

  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(', ')}\n` +
      'Please check your Vercel environment variables configuration.'
    );
  }

  // Warn about optional variables
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.warn('⚠️ SUPABASE_SERVICE_ROLE_KEY not set - admin operations will fail');
  }

  if (!process.env.KV_REST_API_URL || !process.env.KV_REST_API_TOKEN) {
    console.warn('⚠️ Vercel KV not configured - using in-memory storage (not persistent)');
  }

  return true;
}
```

### Fix 2: Update supabase-client.js

**Remove hardcoded fallbacks in production:**

```javascript
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  throw new Error('Supabase credentials not configured. Please set SUPABASE_URL and SUPABASE_ANON_KEY environment variables.');
}
```

### Fix 3: Add Startup Validation

**In `api/v1.js` (top of file):**

```javascript
import { validateEnv } from './lib/env-validator.js';

// Validate environment on first request
let envValidated = false;

export default async function handler(req, res) {
  if (!envValidated) {
    try {
      validateEnv();
      envValidated = true;
    } catch (error) {
      return res.status(500).json({
        success: false,
        error: 'Configuration error',
        message: error.message
      });
    }
  }
  
  // ... rest of handler
}
```

---

## 6. Comparison Matrix

### Current vs. Required Configuration

| Source | Variable | Current Status | Required Status |
|--------|----------|----------------|-----------------|
| Vercel | `SUPABASE_URL` | ❓ Unknown | ✅ Must be set |
| Vercel | `SUPABASE_ANON_KEY` | ❓ Unknown | ✅ Must be set |
| Vercel | `SUPABASE_SERVICE_ROLE_KEY` | ❓ Unknown | ✅ Must be set |
| Vercel | `KV_REST_API_URL` | ❓ Unknown | ⚪ Optional |
| Vercel | `KV_REST_API_TOKEN` | ❓ Unknown | ⚪ Optional |
| Code | Hardcoded URL | ✅ Present | ❌ Should remove |
| Code | Hardcoded Key | ✅ Present | ❌ Should remove |
| Repo | `.env.example` | ✅ Created | ✅ Complete |

**Note:** Cannot verify Vercel environment variables without dashboard access

---

## 7. Action Items

### Immediate Actions (Critical)
1. ✅ **Created `.env.example`** - Template file for developers
2. ⚠️ **Remove hardcoded credentials** - Security fix needed
3. ⚠️ **Add environment validation** - Prevent silent failures

### Verification Required (Cannot do without access)
1. ❓ **Check Vercel environment variables** - Verify all required vars are set
2. ❓ **Verify variable names match** - Ensure no typos or mismatches
3. ❓ **Test in production** - Confirm variables are loaded correctly

### Recommended (Best practices)
1. ✅ **Document all variables** - In `.env.example`
2. ⚠️ **Add validation logic** - Fail fast on missing vars
3. ⚠️ **Rotate exposed keys** - The hardcoded anon key should be rotated

---

## 8. Security Recommendations

### Critical Security Issues

1. **Exposed Supabase Anon Key**
   - **Risk:** Medium (anon keys are meant to be public, but RLS must be configured)
   - **Action:** Verify RLS policies are in place
   - **Status:** ⚠️ Needs verification

2. **Hardcoded Credentials in Source Code**
   - **Risk:** Medium (if service role key is ever hardcoded)
   - **Action:** Remove all hardcoded secrets
   - **Status:** ⚠️ Needs fix

3. **No Environment Validation**
   - **Risk:** Low (can cause runtime errors)
   - **Action:** Add validation on startup
   - **Status:** ⚠️ Recommended

---

## 9. Next Steps

1. **Apply recommended fixes** to remove hardcoded values
2. **Create env-validator.js** for startup validation
3. **Verify Vercel environment variables** (requires dashboard access)
4. **Test deployment** after changes
5. **Proceed to STEP D** - Supabase Endpoint Testing

---

**Status:** ⚠️ PARTIAL - Created .env.example, identified issues  
**Blockers:** Cannot verify Vercel environment variables without dashboard access  
**Risk Level:** MEDIUM - Hardcoded credentials should be addressed
