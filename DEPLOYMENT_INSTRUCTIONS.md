# تعليمات النشر - MMC-MMS

## 1. نشر التعديلات على Vercel

التعديلات تم رفعها إلى GitHub، وسيتم نشرها تلقائياً على Vercel.

### التحقق من النشر:
1. اذهب إلى: https://vercel.com/dashboard
2. افتح مشروع `love-api`
3. تحقق من آخر deployment
4. انتظر حتى يكتمل البناء

## 2. إضافة Cron Job في Supabase

**يجب تنفيذ هذه الخطوات يدوياً**:

1. اذهب إلى: https://supabase.com/dashboard/project/rujwuruuosffcxazymit/functions
2. اضغط على "Create Function"
3. املأ التفاصيل:
   - **Name**: `generate-pins-cron`
   - **Code**: انسخ الكود من `supabase/functions/generate-pins-cron/index.ts`
4. احفظ الـ Function
5. اذهب إلى "Cron Jobs" في Supabase
6. أضف جدولة جديدة:
   - **Function**: `generate-pins-cron`
   - **Schedule**: `0 5 * * *`
   - **Timezone**: `Asia/Riyadh`
7. احفظ

## 3. إضافة بيانات المسؤول

**يجب إضافة مستخدم المسؤول يدوياً في Supabase**:

1. اذهب إلى: https://supabase.com/dashboard/project/rujwuruuosffcxazymit/editor
2. افتح جدول `admins`
3. أضف سطر جديد:
   ```sql
   INSERT INTO admins (username, password, created_at)
   VALUES ('Bomussa', 'YOUR_HASHED_PASSWORD', NOW());
   ```
4. **ملاحظة**: استخدم bcrypt لتشفير كلمة المرور قبل الإدراج

## 4. اختبار النظام

### 4.1. اختبار API
```bash
curl https://mmc-mms.com/api/v1/status
```

**النتيجة المتوقعة**:
```json
{
  "success": true,
  "status": "healthy",
  "mode": "online",
  "backend": "up"
}
```

### 4.2. اختبار نظام الطوابير
```bash
curl https://mmc-mms.com/api/v1/stats/queues
```

**النتيجة المتوقعة**:
```json
{
  "success": true,
  "queues": [...],
  "realTimeQueue": {
    "totalWaiting": 10,
    "nextInLine": "patient-123",
    "precision": "Real-time from Supabase"
  }
}
```

### 4.3. اختبار توليد PIN
```bash
curl -X POST https://mmc-mms.com/api/v1/pin/generate \
  -H "Content-Type: application/json" \
  -d '{"clinic": "clinic-a"}'
```

## 5. المتغيرات المطلوبة في Vercel

تأكد من وجود هذه المتغيرات في Vercel:

- `VITE_SUPABASE_URL`: `https://rujwuruuosffcxazymit.supabase.co`
- `VITE_SUPABASE_ANON_KEY`: (الموجود حالياً)
- `SUPABASE_SERVICE_ROLE_KEY`: (للـ Cron Job)

## 6. استكشاف الأخطاء

### المشكلة: "Failed to fetch queue data"
**الحل**: تحقق من أن:
- جدول `clinics` يحتوي على عيادات نشطة (`is_active = true`)
- جدول `queue` يحتوي على بيانات

### المشكلة: "Unauthorized"
**الحل**: تحقق من أن `VITE_SUPABASE_ANON_KEY` صحيح

### المشكلة: PINs لا تتولد
**الحل**: تحقق من:
- Cron Job مفعّل في Supabase
- `SUPABASE_SERVICE_ROLE_KEY` موجود في Environment Variables

## 7. الدعم

إذا واجهت أي مشاكل، راجع:
- `FINAL_REPORT_2025-11-01.md` - التقرير الكامل
- `FIXES_APPLIED.md` - تفاصيل التعديلات
- Logs في Vercel Dashboard
- Logs في Supabase Dashboard
