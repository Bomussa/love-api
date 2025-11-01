# الإصلاحات المطلوبة - 2025-11-01

## 1. إضافة Supabase Client

✅ تم إنشاء `api/supabase-client.js`

## 2. تحديث v1.js

### التعديل #1: إضافة import
**الموقع**: السطر 6
**قبل**:
```javascript
import { createEnv } from './lib/storage.js';
```

**بعد**:
```javascript
import { createEnv } from './lib/storage.js';
import { supabaseQuery, supabaseInsert, supabaseUpdate } from './supabase-client.js';
```

### التعديل #2: استبدال Mock Data في /stats/queues
**الموقع**: السطور 312-346
**استبدال الكود بالكامل بـ**:

```javascript
    if (pathname === '/api/v1/stats/queues' && method === 'GET') {
      try {
        // 1. Fetch all active clinics from Supabase
        const clinics = await supabaseQuery('clinics', {
          filter: { is_active: true }
        });

        // 2. Get queue count for each clinic
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

        // 3. Apply Dynamic Pathing Sort Logic
        const sortedQueues = queuesWithCounts.sort((a, b) => {
          if (a.currentPatients === 0 && b.currentPatients !== 0) return -1; 
          if (a.currentPatients !== 0 && b.currentPatients === 0) return 1;  
          return a.currentPatients - b.currentPatients; 
        });

        // 4. Get real-time queue status
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

## 3. إضافة Cron Job لتوليد PINs

### إنشاء Edge Function جديدة: `supabase/functions/generate-pins-cron/index.ts`

```typescript
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

serve(async (req) => {
  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    // Get all active clinics
    const { data: clinics, error: clinicsError } = await supabaseClient
      .from('clinics')
      .select('id')
      .eq('is_active', true)

    if (clinicsError) throw clinicsError

    // Generate PIN for each clinic
    const results = await Promise.all(
      clinics.map(async (clinic) => {
        const pin = String(Math.floor(Math.random() * 90) + 10).padStart(2, '0')
        const expiresAt = new Date()
        expiresAt.setHours(23, 59, 59, 999) // Expires at end of day

        // Insert into pins table
        const { error: pinError } = await supabaseClient
          .from('pins')
          .insert({
            clinic_id: clinic.id,
            pin_code: pin,
            expires_at: expiresAt.toISOString(),
            is_used: false
          })

        if (pinError) throw pinError

        // Update clinic with new PIN
        const { error: updateError } = await supabaseClient
          .from('clinics')
          .update({
            pin_code: pin,
            pin_expires_at: expiresAt.toISOString(),
            updated_at: new Date().toISOString()
          })
          .eq('id', clinic.id)

        if (updateError) throw updateError

        return { clinic_id: clinic.id, pin }
      })
    )

    return new Response(
      JSON.stringify({
        success: true,
        message: 'PINs generated successfully',
        results
      }),
      { headers: { "Content-Type": "application/json" } }
    )
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    )
  }
})
```

### إعداد Cron في Supabase Dashboard:
1. اذهب إلى Edge Functions
2. أنشئ Function جديدة باسم `generate-pins-cron`
3. الصق الكود أعلاه
4. في إعدادات Function، أضف Cron Schedule:
   - Schedule: `0 5 * * *` (كل يوم الساعة 5 صباحاً)

