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

        const url = new URL(req.url)
        const clinicId = url.searchParams.get('clinic')

        if (!clinicId) {
            throw new Error('Missing clinic parameter')
        }

        // 1. Get Waiting List
        const { data: waiting, error: waitingError } = await supabase
            .from('queue')
            .select('*')
            .eq('clinic_id', clinicId)
            .eq('status', 'waiting')
            .order('position', { ascending: true })

        if (waitingError) throw waitingError

        // 2. Get Currently Serving
        const { data: serving, error: servingError } = await supabase
            .from('queue')
            .select('*')
            .eq('clinic_id', clinicId)
            .in('status', ['called', 'in_service']) // Check both
            .order('called_at', { ascending: false })
            .limit(1)
            .maybeSingle()
        
        if (servingError) throw servingError

        // 3. Format Response
        return new Response(
            JSON.stringify({
                success: true,
                waiting: waiting.length,
                serving: serving ? serving.ticket_number : null,
                queue: waiting,
                in: serving ? [serving] : [],
                current_serving: serving // For compatibility
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
