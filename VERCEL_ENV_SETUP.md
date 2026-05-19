# Vercel Environment Variables Setup (love-api + frontend connectivity)

## الهدف
ضمان أن الفرونت متصل دائمًا بالباك اند مع تقليل الانقطاع عبر إعداد بيئة صحيح + إعدادات اعتمادية موحدة.

---

## 1) متغيرات أساسية مطلوبة على مشروع `love-api` في Vercel

اضبطها في **Production + Preview + Development**:

```bash
SUPABASE_URL=https://rujwuruuosffcxazymit.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<service-role-key>
SUPABASE_ANON_KEY=<anon-key>
```

> ملاحظة: لم يعد هناك أي fallback URL/Key صامت. أي نقص في المتغيرات أعلاه سيؤدي إلى فشل startup بشكل صريح.

---

## 2) متغيرات frontend المطلوبة (مشروع love)

```bash
NEXT_PUBLIC_API_BASE_URL=https://mmc-mms.com/api/v1
NEXT_PUBLIC_API_TIMEOUT_MS=12000
NEXT_PUBLIC_HEALTHCHECK_INTERVAL_MS=30000
NEXT_PUBLIC_RETRY_MAX=3
NEXT_PUBLIC_RETRY_BACKOFF_MS=500
```

### إعدادات الدومين
- يجب أن يكون `mmc-mms.com` و `www.mmc-mms.com` على نفس المحتوى.
- أي redirect يجب أن يكون 301 ثابتًا ومنضبطًا (بدون loop).

---

## 3) سياسات اتصال تمنع الانقطاع

### Timeout
- GET: `8000ms`
- POST/PUT/PATCH/DELETE: `12000ms`

### Retry
- retries على network/5xx فقط
- لا retries على 4xx
- exponential backoff: `500ms`, `1000ms`, `2000ms`

### Circuit breaker
- إذا تكرر الفشل 5 مرات/60 ثانية:
  - إيقاف عمليات mutation مؤقتًا لمدة 30 ثانية
  - الاستمرار على `/health` فقط

### Fallback UX
- إظهار حالة "جاري إعادة الاتصال"
- cache آخر بيانات قراءة إن أمكن
- زر "إعادة المحاولة" يدويًا

---

## 4) خطوات الإعداد على Vercel

1. افتح مشروع `love-api` في Vercel.
2. Settings → Environment Variables.
3. أضف المتغيرات المذكورة أعلاه.
4. كرر العملية لمشروع `love` frontend بمتغيرات `NEXT_PUBLIC_*`.
5. نفّذ Redeploy للمشروعين.

---

## 5) تحقق بعد النشر (Production Verification)

- `GET https://mmc-mms.com/api/v1/health`
- `GET https://www.mmc-mms.com/api/v1/health`
- `GET https://mmc-mms.com/api/v1/qa/deep_run`

يجب أن تكون النتيجة `success: true` ووقت استجابة مستقر.

---

## 6) أمان

- لا تضع `SUPABASE_SERVICE_ROLE_KEY` في الفرونت أو في `NEXT_PUBLIC_*`.
- لا ترفع secrets إلى GitHub.
- فعّل key rotation دوريًا.


## 7) Startup Validation (إجباري)

الخدمة ترفض التشغيل إذا غاب أي متغير إلزامي:

- Backend (`love-api`):
  - `SUPABASE_URL`
  - `SUPABASE_SERVICE_ROLE_KEY` (أو `SUPABASE_KEY` فقط للتوافق الخلفي داخل بعض الوحدات)
  - `SUPABASE_ANON_KEY` للوحدات العامة التي تستدعي Edge Functions.
- Frontend (`love`):
  - `VITE_SUPABASE_URL`
  - `VITE_SUPABASE_ANON_KEY`

ينطبق ذلك على بيئات `Production` و`Preview` و`Development`.
