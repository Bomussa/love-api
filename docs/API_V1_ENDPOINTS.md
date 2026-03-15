# API_V1_ENDPOINTS.md — المسارات الفعلية الحالية في `api/v1.js`
> المصدر: `api/v1.js` | آخر تحديث: 2026-03-15

## Endpoints المنفذة فعليًا

| # | Route | Method | الوصف |
|---|-------|--------|-------|
| 1 | `/api/v1/health` | GET | فحص صحة API |
| 2 | `/api/health` | GET | alias للصحة |
| 3 | `/api/v1/qa/deep_run` | GET | تقرير QA ونتائج الإصلاحات |
| 4 | `/api/v1/qa/deep_run` | POST | تشغيل self-healing (محمي Admin Token) |
| 5 | `/api/v1/admin/login` | POST | تسجيل دخول مشرف |
| 6 | `/api/v1/admins` | GET | قائمة المشرفين (محمي) |
| 7 | `/api/v1/admins` | POST | إنشاء مشرف (محمي) |
| 8 | `/api/v1/admins/:id` | PATCH | تعديل مشرف (محمي) |
| 9 | `/api/v1/admins/:id` | DELETE | حذف مشرف (محمي) |
| 10 | `/api/v1/stats-dashboard` | GET | لوحة الإحصائيات |

## ملاحظات التوافق

- التوثيق القديم كان يتضمن مسارات كثيرة غير موجودة داخل `api/v1.js` (مثل `/api/v1/admin/users` و`/api/v1/settings` وغيرهما).
- توجد مجموعة مسارات إضافية في `lib/api-handlers.js` ضمن راوتر مختلف؛ لذلك يجب عدم دمج التوثيقين كأنهما نفس العقدة التنفيذية.
- أي عميل يستهلك `api/v1.js` يجب أن يعتمد القائمة أعلاه فقط.
