# API_V1_ENDPOINTS.md — قائمة Endpoints الفعلية في api/v1.js
> المصدر: `love-api/api/v1.js` | تاريخ الاستخراج: 2026-02-22

---

## قائمة Endpoints الكاملة

| # | Route | Method | الوصف | السطر |
|---|-------|--------|-------|-------|
| 1 | `/api/v1/health` | GET | فحص صحة الـAPI | 207 |
| 2 | `/api/v1/admin/login` | POST | تسجيل دخول المشرف | 210 |
| 3 | `/api/v1/admin/users` | GET | جلب قائمة المشرفين | 222 |
| 4 | `/api/v1/admin/users` | POST | إنشاء مشرف جديد | 238 |
| 5 | `/api/v1/admin/users/:id` | PATCH | تعديل بيانات مشرف | 298 |
| 6 | `/api/v1/admin/users/:id` | DELETE | حذف مشرف | 304 |
| 7 | `/api/v1/admin/clinics` | GET | جلب قائمة العيادات | 304 |
| 8 | `/api/v1/admin/clinics` | POST | إنشاء عيادة جديدة | 356 |
| 9 | `/api/v1/admin/clinics/:id` | PATCH | تعديل بيانات عيادة | 398 |
| 10 | `/api/v1/admin/clinics/:id` | DELETE | حذف عيادة | 420 |
| 11 | `/api/v1/admin/queues` | GET | جلب قائمة الطوابير | 433 |
| 12 | `/api/v1/admin/queues/:id` | PATCH | تعديل حالة مراجع في الطابور | 448 |
| 13 | `/api/v1/admin/queues/:id` | DELETE | حذف مراجع من الطابور | 530 |
| 14 | `/api/v1/admin/queues/move-to-end` | POST | نقل مراجع لنهاية الطابور | 536 |
| 15 | `/api/v1/admin/pins` | GET | جلب أرقام PIN | 558 |
| 16 | `/api/v1/admin/pins/regenerate` | POST | إعادة توليد PIN | 574 |
| 17 | `/api/v1/admin/reports/stats` | GET | تقارير الإحصائيات | 584 |
| 18 | `/api/v1/settings` | GET | جلب الإعدادات | 605 |
| 19 | `/api/v1/settings` | PATCH | تعديل الإعدادات | 615 |
| 20 | `/api/v1/settings/calculate-wait` | GET | حساب وقت الانتظار | 639 |
| 21 | `/api/v1/admin/notifications` | GET | جلب الإشعارات | 645 |
| 22 | `/api/v1/admin/notifications` | POST | إرسال إشعار | 652 |
| 23 | `/api/v1/admin/activity-log` | GET | جلب سجل النشاط | 667 |
| 24 | `/api/v1/admin/activity-log` | POST | تسجيل نشاط | 692 |
| 25 | `/api/v1/pin/generate` | POST | توليد PIN | 710 |
| 26 | `/api/v1/pin/validate` | POST | التحقق من PIN | 719 |
| 27 | `/api/v1/patients/login` | POST | تسجيل دخول مراجع | 741 |
| 28 | `/api/v1/queue/get-number` | POST | الحصول على رقم الطابور | 768 |
| 29 | `/api/v1/queue/enter` | POST | دخول الطابور | - |
| 30 | `/api/v1/queue/status` | GET | حالة الطابور | - |
| 31 | `/api/v1/queue/next` | POST | استدعاء المراجع التالي | - |
| 32 | `/api/v1/queue/done` | POST | إنهاء فحص مراجع | - |
| 33 | `/api/v1/pathway/:patientId` | GET | مسار المراجع | - |

---

## ملاحظات
- جميع Endpoints تحت مسار `/api/v1` كما هو مطلوب
- يوجد CORS مفعّل لجميع الطلبات
- المصادقة تعتمد على `Authorization: Bearer <token>` للـAdmin endpoints
- `queue/get-number` يستخدم `getNextDisplayNumber()` غير الذري (خطر race condition)
