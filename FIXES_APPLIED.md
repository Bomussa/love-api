# الإصلاحات المطبقة - 2025-11-01

## المشاكل المكتشفة

1. ❌ **Mock Data** في `/api/v1/stats/queues` - لا يقرأ من Supabase
2. ❌ **لا يوجد Cron Job** لتوليد PINs الساعة 5 صباحاً
3. ❌ **نظام الأرقام** لا يظهر البيانات الحقيقية

## الحلول المطبقة

### 1. إنشاء Supabase Client ✅

**الملف**: `api/supabase-client.js`

تم إنشاء helper functions للاتصال بـ Supabase:
- `supabaseQuery()` - للقراءة
- `supabaseInsert()` - للإدراج
- `supabaseUpdate()` - للتحديث

### 2. تحديث v1.js (يدوياً)

**يجب تطبيق التعديلات التالية**:

#### التعديل #1: إضافة Import
**الموقع**: بعد السطر 13

```javascript
import { supabaseQuery, supabaseInsert, supabaseUpdate } from './supabase-client.js';
```

#### التعديل #2: استبدال `/stats/queues`
**الموقع**: السطور 312-346

استبدل الكود الحالي بـ:

```javascript
    if (pathname === '/api/v1/stats/queues' && method === 'GET') {
      try {
        // Fetch all active clinics from Supabase
        const clinics = await supabaseQuery('clinics', {
          filter: { is_active: true }
        });

        // Get queue count for each clinic
        const queuesWithCounts = await Promise.all(
          clinics.map(async (clinic) => {
            const queueData = await supabaseQuery('queue', {
              filter: { clinic_id: clinic.id, status: 'waiting' }
            });
            
            return {
              id: clinic.id,
              name: clinic.name_ar || clinic.name,
              currentPatients: queueData.length,
              status: clinic.is_active ? 'open' : 'closed',
              lastUpdate: new Date().toISOString()
            };
          })
        );

        // Apply Dynamic Pathing Sort Logic
        const sortedQueues = queuesWithCounts.sort((a, b) => {
          if (a.currentPatients === 0 && b.currentPatients !== 0) return -1; 
          if (a.currentPatients !== 0 && b.currentPatients === 0) return 1;  
          return a.currentPatients - b.currentPatients; 
        });

        // Get real-time queue status
        const allWaitingPatients = await supabaseQuery('queue', {
          filter: { status: 'waiting' },
          order: 'position.asc',
          limit: 2
        });

        const realTimeQueue = {
          totalWaiting: queuesWithCounts.reduce((sum, q) => sum + q.currentPatients, 0),
          nextInLine: allWaitingPatients[0]?.patient_id || null,
          lastCall: allWaitingPatients[1]?.patient_id || null,
          precision: 'Real-time from Supabase'
        };

        return res.status(200).json({
          success: true,
          queues: sortedQueues,
          realTimeQueue: realTimeQueue
        });
      } catch (error) {
        console.error('Error fetching queues:', error);
        return res.status(500).json({
          success: false,
          error: 'Failed to fetch queue data'
        });
      }
    }
```

### 3. إنشاء Cron Job في Supabase

**يجب إنشاء Edge Function جديدة في Supabase Dashboard**:

1. اذهب إلى: https://supabase.com/dashboard/project/rujwuruuosffcxazymit/functions
2. اضغط "Create Function"
3. الاسم: `generate-pins-cron`
4. الصق الكود التالي:

```typescript
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

serve(async (req) => {
  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    const { data: clinics } = await supabaseClient
      .from('clinics')
      .select('id')
      .eq('is_active', true)

    const results = await Promise.all(
      clinics.map(async (clinic) => {
        const pin = String(Math.floor(Math.random() * 90) + 10).padStart(2, '0')
        const expiresAt = new Date()
        expiresAt.setHours(23, 59, 59, 999)

        await supabaseClient.from('pins').insert({
          clinic_id: clinic.id,
          pin_code: pin,
          expires_at: expiresAt.toISOString(),
          is_used: false
        })

        await supabaseClient.from('clinics').update({
          pin_code: pin,
          pin_expires_at: expiresAt.toISOString()
        }).eq('id', clinic.id)

        return { clinic_id: clinic.id, pin }
      })
    )

    return new Response(JSON.stringify({ success: true, results }), {
      headers: { "Content-Type": "application/json" }
    })
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    })
  }
})
```

5. في Function Settings، أضف Cron Schedule:
   - **Expression**: `0 5 * * *`
   - **Timezone**: Asia/Riyadh (أو حسب منطقتك)

## الخطوات المتبقية

1. ✅ تم إنشاء `supabase-client.js`
2. ⏳ **يدوياً**: تطبيق التعديلات على `v1.js`
3. ⏳ **يدوياً**: إنشاء Cron Function في Supabase
4. ⏳ رفع التعديلات إلى GitHub
5. ⏳ اختبار النظام

## النتيجة المتوقعة

- ✅ نظام الأرقام يظهر البيانات الحقيقية من Supabase
- ✅ المسارات تتغير حسب الأعداد الحقيقية
- ✅ PINs تتولد تلقائياً الساعة 5 صباحاً
- ✅ لا توجد Mock Data

---

**ملاحظة**: لم أقم بتطبيق التعديلات تلقائياً لأنك طلبت عدم التغيير قبل التأكد.
