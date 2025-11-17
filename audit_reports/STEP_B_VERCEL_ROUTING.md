# STEP B — Vercel Routing Rebuild Report

**Date:** 2025-11-17  
**Repository:** Bomussa/love-api  
**Focus:** Vercel Configuration & Routing  

---

## 1. Current vercel.json Analysis

### Current Configuration
**File:** `/vercel.json`

```json
{
  "headers": [
    {
      "source": "/api/(.*)",
      "headers": [
        {
          "key": "Access-Control-Allow-Origin",
          "value": "*"
        },
        {
          "key": "Access-Control-Allow-Methods",
          "value": "GET, POST, PUT, DELETE, OPTIONS"
        },
        {
          "key": "Access-Control-Allow-Headers",
          "value": "Content-Type, Authorization"
        },
        {
          "key": "X-Frame-Options",
          "value": "SAMEORIGIN"
        },
        {
          "key": "X-Content-Type-Options",
          "value": "nosniff"
        }
      ]
    }
  ]
}
```

### Issues Identified

#### ❌ CRITICAL: Missing Rewrites Section
The instructions specify that `vercel.json` MUST contain:

```json
{
  "rewrites": [
    {
      "source": "/api/(.*)",
      "destination": "https://subspace.vercel.app/api/v1/$1"
    }
  ]
}
```

**However, there is a CONFLICT:**
- The instructions mention rewriting to `https://subspace.vercel.app/api/v1/$1`
- But the repository contains **local API handlers** in `/api/` directory
- The project architecture shows this is a **Vercel Serverless Functions** setup, NOT a proxy

---

## 2. Architecture Analysis

### Current Setup (Based on Repository Structure)
```
love-api (Backend API)
├── /api/[...slug].js          → Vercel Serverless Function
├── /api/v1.js                 → Main handler
└── /supabase/functions/       → Supabase Edge Functions
```

### Expected Flow (Based on Knowledge Base)
```
Frontend (love repo on Vercel)
    ↓
    /api/* requests
    ↓
Supabase Backend
    ↓
    PostgREST (/rest/v1/*)
    Edge Functions (/functions/v1/*)
```

---

## 3. Conflict Resolution Analysis

### The Confusion
The instructions say:
> "destination": "https://subspace.vercel.app/api/v1/$1"

But the knowledge base says:
> FRONTEND_REPO: love
> BACKEND_PLATFORM: Supabase
> NO_VERCEL_FUNCTIONS: true

### The Reality
Looking at the repository structure:
1. **This repo (love-api)** contains Vercel serverless functions
2. **The frontend (love)** should be a separate repo
3. **The backend** should be on Supabase

---

## 4. Correct Configuration (Based on Architecture)

### Option 1: If this is the BACKEND API repo (current setup)
```json
{
  "headers": [
    {
      "source": "/api/(.*)",
      "headers": [
        {
          "key": "Access-Control-Allow-Origin",
          "value": "*"
        },
        {
          "key": "Access-Control-Allow-Methods",
          "value": "GET, POST, PUT, DELETE, OPTIONS"
        },
        {
          "key": "Access-Control-Allow-Headers",
          "value": "Content-Type, Authorization"
        }
      ]
    }
  ],
  "functions": {
    "api/**/*.js": {
      "memory": 1024,
      "maxDuration": 10
    }
  }
}
```

### Option 2: If this should PROXY to Supabase (as per instructions)
```json
{
  "rewrites": [
    {
      "source": "/api/v1/(.*)",
      "destination": "https://rujwuruuosffcxazymit.supabase.co/functions/v1/$1"
    }
  ],
  "headers": [
    {
      "source": "/api/(.*)",
      "headers": [
        {
          "key": "Access-Control-Allow-Origin",
          "value": "*"
        },
        {
          "key": "Access-Control-Allow-Methods",
          "value": "GET, POST, PUT, DELETE, OPTIONS"
        },
        {
          "key": "Access-Control-Allow-Headers",
          "value": "Content-Type, Authorization"
        }
      ]
    }
  ]
}
```

---

## 5. Recommended Action

### ⚠️ DECISION REQUIRED

Based on the analysis, we need to clarify:

1. **Is `love-api` the backend API that serves requests?**
   - If YES → Keep current structure, add `functions` config
   - If NO → Add rewrites to proxy to Supabase

2. **What is the role of `https://subspace.vercel.app`?**
   - Is it a different deployment?
   - Is it the production URL of this repo?
   - Is it a typo and should be the Supabase URL?

3. **Should we use Vercel Functions or Supabase Edge Functions?**
   - Current code uses Vercel Functions
   - Knowledge base says "NO_VERCEL_FUNCTIONS: true"
   - Supabase functions exist but are not being used

---

## 6. Proposed Fix (Conservative Approach)

### Fix 1: Add Functions Configuration
Since the code exists and works, we should configure it properly:

```json
{
  "headers": [
    {
      "source": "/api/(.*)",
      "headers": [
        {
          "key": "Access-Control-Allow-Origin",
          "value": "*"
        },
        {
          "key": "Access-Control-Allow-Methods",
          "value": "GET, POST, PUT, DELETE, OPTIONS"
        },
        {
          "key": "Access-Control-Allow-Headers",
          "value": "Content-Type, Authorization"
        },
        {
          "key": "X-Frame-Options",
          "value": "SAMEORIGIN"
        },
        {
          "key": "X-Content-Type-Options",
          "value": "nosniff"
        }
      ]
    }
  ],
  "functions": {
    "api/**/*.js": {
      "memory": 1024,
      "maxDuration": 10
    }
  },
  "rewrites": [
    {
      "source": "/api/v1/:path*",
      "destination": "/api/:path*"
    }
  ]
}
```

This configuration:
- ✅ Keeps existing headers
- ✅ Adds function configuration for better performance
- ✅ Adds internal rewrite to normalize `/api/v1/*` to `/api/*`
- ✅ Does NOT break existing functionality

---

## 7. Validation Checklist

Before applying changes:

- [ ] Confirm JSON syntax is valid
- [ ] Confirm no conflicting rewrites
- [ ] Confirm no duplicate routing files
- [ ] Confirm Vercel build uses this file ONLY
- [ ] Test routing after deployment

---

## 8. Next Steps

1. **Apply the conservative fix** to `vercel.json`
2. **Test locally** if possible
3. **Deploy to Vercel** and verify
4. **Monitor logs** for any routing errors
5. **Proceed to STEP C** - Environment Variables

---

**Status:** ⚠️ PENDING DECISION  
**Recommendation:** Apply conservative fix and test  
**Risk Level:** LOW (changes are additive, not destructive)
