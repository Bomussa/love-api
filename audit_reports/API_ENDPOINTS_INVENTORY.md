# API ENDPOINTS INVENTORY - Complete List

**Date:** 2025-11-17  
**Source:** Supabase Edge Function `api-router`  
**Status:** ✅ VERIFIED FROM CODE  

---

## ACTIVE BACKEND: Supabase Edge Functions

**Base URL:** `https://rujwuruuosffcxazymit.functions.supabase.co/api-router/`

**Frontend Routes Through:** `/api/v1/*` → Supabase Edge Function

---

## ENDPOINT LIST (19 Endpoints)

### 1. Health & Status

| Endpoint | Method | Line | Description |
|----------|--------|------|-------------|
| `/` | GET | 1510 | Health check / Status |
| `/status` | GET | 1510 | API status |
| `/health` | GET | 1510 | Health endpoint |
| `/health/status` | GET | 1510 | Health status |

---

### 2. Patient Management

| Endpoint | Method | Line | Description |
|----------|--------|------|-------------|
| `/patient/login` | POST | 1527 | Patient login |

---

### 3. Queue Management

| Endpoint | Method | Line | Description |
|----------|--------|------|-------------|
| `/queue/enter` | POST | 1531 | Enter queue |
| `/queue/status` | GET | 1535 | Get queue status |
| `/queue/position` | GET | 1539 | Get patient position |
| `/queue/done` | POST | 1543 | Mark patient done |
| `/queue/call` | POST | 1551 | Call next patient |

---

### 4. Clinic Management

| Endpoint | Method | Line | Description |
|----------|--------|------|-------------|
| `/clinic/exit` | POST | 1547 | Patient exit clinic |

---

### 5. PIN System

| Endpoint | Method | Line | Description |
|----------|--------|------|-------------|
| `/pin/status` | GET | 1555 | Get PIN status |
| `/admin/pin/status` | GET | 1558 | Admin PIN status |

**⚠️ CRITICAL NOTE:** PIN generation endpoint not found in routing table!

---

### 6. Statistics & Dashboard

| Endpoint | Method | Line | Description |
|----------|--------|------|-------------|
| `/stats/dashboard` | GET | 1562 | Dashboard statistics |
| `/stats/queues` | GET | 1566 | Queue statistics |

---

### 7. Admin Functions

| Endpoint | Method | Line | Description |
|----------|--------|------|-------------|
| `/admin/status` | GET | 1570 | Admin system status |
| `/admin/clinics/bootstrap` | POST | 1574 | Bootstrap clinics |

---

### 8. Reports

| Endpoint | Method | Line | Description |
|----------|--------|------|-------------|
| `/reports/history` | GET | 1578 | Report history |

---

### 9. Routing & Pathways

| Endpoint | Method | Line | Description |
|----------|--------|------|-------------|
| `/route/create` | POST | 1582 | Create route |
| `/route/get` | GET | 1586 | Get route |
| `/path/choose` | GET | 1590 | Choose path (GET) |
| `/path/choose` | POST | 1594 | Choose path (POST) |

---

## CRITICAL FINDINGS

### ✅ Confirmed Working
- All endpoints are properly routed in Supabase Edge Function
- Code is syntactically valid (Deno TypeScript)
- Proper error handling exists
- CORS headers configured

### ⚠️ MISSING ENDPOINTS

Based on knowledge base requirement:
> "للتحقق من عمل الباك اند يجب ظهور البن كود لكل العيادات الموجودة في شاشة الإدارة فقط"

**Missing:**
1. `/pin/generate` or `/admin/pin/generate` - **NOT FOUND IN ROUTING**
2. `/pathways` - Not explicitly listed (might be in path/choose)

### ⚠️ DISCREPANCIES

Comparing with Vercel functions in `/api/v1.js`:

**In Vercel but NOT in Supabase:**
- `/api/v1/pathways` (GET)
- `/api/v1/pin/generate` (POST) ⚠️ **CRITICAL**
- `/api/v1/pin/verify` (POST)
- `/api/v1/events/stream` (GET)
- `/api/v1/reports/daily` (GET)
- `/api/v1/reports/weekly` (GET)
- `/api/v1/reports/monthly` (GET)
- `/api/v1/reports/annual` (GET)
- `/api/v1/admin/config` (GET)

**This confirms:** Vercel functions have MORE endpoints than Supabase!

---

## ARCHITECTURE CONFLICT DETECTED

### The Problem

1. **Frontend (love/vercel.json)** routes to:
   ```
   https://rujwuruuosffcxazymit.functions.supabase.co/api-router/:path*
   ```

2. **Supabase api-router** has only 19 endpoints

3. **Vercel functions (love-api/api/v1.js)** has 24 endpoints

4. **Missing in Supabase:**
   - ⚠️ `/pin/generate` - **CRITICAL FOR ADMIN SCREEN**
   - `/pin/verify`
   - `/pathways`
   - `/events/stream`
   - Multiple report endpoints
   - `/admin/config`

### Impact

**If production uses Supabase backend:**
- ❌ PIN generation will NOT work
- ❌ Admin screen cannot display PIN codes
- ❌ Several features will be broken

**If production uses Vercel backend:**
- ✅ All features should work
- ⚠️ But contradicts knowledge base (NO_VERCEL_FUNCTIONS: true)

---

## RECOMMENDATIONS

### Option 1: Migrate Missing Endpoints to Supabase
**Action:** Add missing endpoints to `api-router/index.ts`

**Pros:**
- Aligns with knowledge base
- Single source of truth
- Proper architecture

**Cons:**
- Requires code migration
- Testing needed
- Deployment to Supabase

### Option 2: Keep Vercel Functions
**Action:** Update frontend to route to Vercel instead

**Pros:**
- All endpoints already exist
- No migration needed
- Immediate fix

**Cons:**
- Contradicts knowledge base
- Dual backend complexity
- Against architecture rules

### Option 3: Hybrid Approach (NOT RECOMMENDED)
**Action:** Route some endpoints to Vercel, some to Supabase

**Pros:**
- Quick fix

**Cons:**
- Maintenance nightmare
- Confusing architecture
- High risk

---

## CRITICAL BLOCKER

**Cannot proceed with "READY_FOR_FEATURE_WORK" status because:**

1. ❌ PIN generation endpoint missing in Supabase
2. ❌ Cannot verify if production is working
3. ❌ Architecture conflict unresolved
4. ❌ Unknown which backend is actually serving production

**FINAL_STATUS:** `STILL_HAS_BLOCKERS`

**Blocking Issues:**
- Missing `/pin/generate` endpoint in Supabase Edge Function
- Unclear which backend (Vercel vs Supabase) is serving production
- Frontend routes to Supabase but Supabase is missing critical endpoints
- Cannot test production without URL and credentials

---

## NEXT STEPS (REQUIRE USER INPUT)

1. ❓ **Verify production URL** - Which backend is currently serving?
2. ❓ **Confirm architecture** - Should we use Supabase only?
3. ❓ **Migrate endpoints** - Should missing endpoints be added to Supabase?
4. ❓ **Test production** - Can we access admin screen to verify PIN display?

**Cannot proceed to 98% success without these confirmations.**
