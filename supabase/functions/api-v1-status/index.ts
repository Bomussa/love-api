// @ts-nocheck
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders })
    }

    try {
        const supabase = createClient(
            Deno.env.get('SUPABASE_URL') ?? '',
            Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
        )

        // Get total patients today
        const today = new Date().toISOString().split('T')[0];
        const { count: totalToday } = await supabase
          .from('queue')
          .select('*', { count: 'exact', head: true })
          .gte('entered_at', `${today}T00:00:00`);

        // Get waiting count
        const { count: waiting } = await supabase
          .from('queue')
          .select('*', { count: 'exact', head: true })
          .eq('status', 'waiting');

        // Get completed count today
        const { count: completed } = await supabase
          .from('queue')
          .select('*', { count: 'exact', head: true })
          .eq('status', 'completed')
          .gte('completed_at', `${today}T00:00:00`);

        // Get active PINs count
        const { count: activePins } = await supabase
          .from('clinics')
          .select('*', { count: 'exact', head: true })
          .eq('is_active', true)
          .not('pin_code', 'is', null);

        return new Response(
            JSON.stringify({
                success: true,
                totalToday: totalToday || 0,
                waiting: waiting || 0,
                completed: completed || 0,
                activePins: activePins || 0
            }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )

    } catch (error) {
        return new Response(
            JSON.stringify({ success: false, error: error.message }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
    }
})
