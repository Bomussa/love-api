# love-api — المرجع التشغيلي الأول للمستودع

> آخر تحديث: 2026-04-08  
> هذا الدليل يجمع: بنية المشروع، المسارات الحرجة، الدوال/الوحدات المهمة، خطوات الاختبار، ومناطق المخاطر.

---

## 1) الهدف

`love-api` هو Backend لنظام إدارة الفحص الطبي (MMC)، ويقدم:
- مسارات API v1 للطوابير والدخول والإحصائيات.
- Edge Functions على Supabase لعمليات متخصصة.
- طبقة سكربتات فحص للعقود (Endpoints/Schema).

---

## 2) خريطة المشروع (Directory Map)

## الجذر
- `api/` — Serverless routes (Vercel-style) وأهمها `api/v1.js`.
- `lib/` — وحدات مساعدة، adapters، اختبارات unit.
- `supabase/functions/` — Edge Functions المنشورة على Supabase.
- `supabase/migrations/` — SQL migrations وتوحيد المخطط.
- `scripts/` — أدوات تدقيق العقود والتوافق.
- `tests/` — اختبارات contracts/integration عبر Node test runner.
- `docs/` — وثائق العقود التشغيلية.

---

## 3) ملف التشغيل الرئيسي

## `api/v1.js`
المسؤول عن endpoints الأساسية للفرونت.

### دوال حرجة
- `getSupabaseClient()`
  - الغرض: إنشاء Supabase client بشكل lazy مرة واحدة.
  - الخطر: فشل متغيرات البيئة يوقف الطلبات مبكرًا برسالة صريحة.
- `invokeRpcSafe(...)`
  - الغرض: استدعاء RPC مع كشف حالة "الدالة غير موجودة".
- `normalizeQueueStatus(status)`
  - الغرض: توحيد حالات الدور بين DB والفرونت.
- `getClinicPath(examType, gender)`
  - الغرض: استخراج مسار العيادات الرسمي.
- `getNextClinicInRoute(...)`
  - الغرض: تحديد العيادة التالية أو حالة انتهاء الفحص.
- `handler(req, res)`
  - الغرض: موزع جميع endpoints v1.

### مسارات مهمة جدًا للفرونت
- `GET /api/v1/health` — صحة الخدمة.
- `POST /api/v1/patient/login` — دخول المراجع.
- `POST /api/v1/queue/create` — إنشاء أول دور.
- `GET /api/v1/queue/status` — الحالة العامة + `normalized_status`.
- `POST /api/v1/queue/call` — استدعاء التالي.
- `POST /api/v1/queue/start` — بدء الفحص.
- `POST /api/v1/queue/advance` — تمرير للمحطة التالية / إرجاع `screen: 4` عند النهاية.
- `POST /api/v1/admin/login` — دخول إداري/طبيب مع fallback بين `admins` و`admin_users`.
- `POST /api/v1/admin/bootstrap-doctors` — تهيئة طبيب لكل عيادة فعالة.

---

## 4) ملفات المكتبة (`lib/`) ذات الأثر العالي

- `lib/api-handlers.js`
  - راوتر/مسارات توافقية إضافية لعقود قديمة.
- `lib/supabase.js`, `lib/supabase-db.js`, `lib/supabase-api.js`
  - طبقات اتصال Supabase وعمليات DB.
- `lib/admin-auth.js`
  - منطق توليد/التحقق من توكنات الإدارة.
- `lib/unified-storage.js`
  - طبقة تخزين موحدة/تجريد عمليات البيانات.
- `lib/circuit-breaker.ts`
  - آلية حماية من الانهيار عند فشل متكرر.
- `lib/api-adapter.js`, `lib/enhanced-api.js`
  - توافق مع واجهات مختلفة واختزال فروقات الاستدعاء.

> ملاحظة: أي تعديل في ملفات `lib/*auth*` أو `supabase*` يجب أن يمر باختبارات contracts كاملة.

---

## 5) Edge Functions (`supabase/functions/`)

أهم الوحدات:
- `healthz` — فحص الصحة.
- `api-router` / `functions-proxy` — توجيه وتوافق.
- `queue-enter`, `queue-call`, `queue-status`, `queue-engine` — دورة الطابور.
- `admin-login`, `admin-session-verify` — جلسات الإدارة.
- `pin-generate`, `pin-verify`, `pin-status` — تدفق PIN.
- `reports-daily`, `stats-dashboard` — التقارير.

---

## 6) قاعدة البيانات والمخطط

- المصدر المرجعي الفعلي للتعاقد موثق عبر:
  - `artifacts/schema_snapshot.json`
  - سكربت: `scripts/check-schema-contract.js`
- migration مرجعية للتوحيد:
  - `20260316090000_canonicalize_queues.sql`
  - `20260316090000_unify_pins_contract.sql`
  - `20260316100000_queue_status_lifecycle_enforcement.sql`

---

## 7) كيف تختبر بسرعة وبدقة

```bash
npm test
node scripts/check-endpoint-contracts.js
node scripts/check-schema-contract.js
```

اختبار إنتاج سريع:
```bash
curl -sS https://mmc-mms.com/api/v1/health
curl -sS https://mmc-mms.com/api/v1/qa/deep_run
```

---

## 8) المخاطر الحالية (Known Risk Areas)

1. **ازدواجية مسارات بين `api/v1.js` و`lib/api-handlers.js`**
   - قد تسبب تفاوتًا بالتوقعات إن لم يتم الالتزام بوثيقة العقد.
2. **تعدد أنماط مخطط DB تاريخيًا (`queue` vs `queues`, `admins` vs `admin_users`)**
   - تم تخفيفها عبر fallback/توثيق، لكنها تتطلب انضباط migration.
3. **Smoke test المحلي يعتمد وجود سيرفر محلي**
   - في CI بدون سيرفر، الاختبار لا يكسر pipeline لكنه لا يثبت مسار UI الكامل.
4. **الاعتماد على ضبط env بشكل دقيق**
   - نقص متغيرات Supabase يؤدي فشل سريع (مقصود لتجنب صمت الأعطال).

---

## 9) قواعد التشغيل الآمن

- لا تعرض أي Service Role key في الفرونت.
- لا تدمج تغييرات منطقية قبل تمرير العقود والاختبارات.
- عند تعديل endpoint:
  1) حدث `docs/API_V1_ENDPOINTS.md`
  2) شغل `npm test`
  3) شغل checks الخاصة بالعقود.

---

## 10) مراجع داخلية مهمة

- `docs/API_V1_ENDPOINTS.md` — العقد الرسمي للفرونت.
- `VERCEL_ENV_SETUP.md` — إعداد متغيرات البيئة + الاعتمادية.
- `docs/DB_SOURCE_OF_TRUTH.md` — مصدر الحقيقة لهيكل DB.
- `docs/TRUTH_TREE_LOVE_API.md` — خريطة الحقيقة بين المكونات.
