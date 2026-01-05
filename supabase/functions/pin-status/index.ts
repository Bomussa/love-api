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

        const { data: clinics, error } = await supabase
            .from('clinics')
            .select('id, name_ar, name_en, pin_code, pin_expires_at, is_active')
            .eq('is_active', true)

        if (error) throw error

        const pinStatus = {}
        const now = new Date()

        clinics.forEach(clinic => {
             // Logic to determine if PIN is valid
             const expires = clinic.pin_expires_at ? new Date(clinic.pin_expires_at) : null
             const isActive = clinic.pin_code && expires && expires > now

             if (isActive) {
                 pinStatus[clinic.id] = {
                     clinicName: clinic.name_ar || clinic.id,
                     // Don't return the actual PIN unless authenticated admin? 
                     // Frontend needs it to show "PIN Active"? 
                     // Or AdminPINMonitor needs it?
                     // Let's return the PIN for now as requested by user (testing "Admin Screen completely")
                     // In prod, this should be guarded.
                     pin: clinic.pin_code, 
                     expiresAt: clinic.pin_expires_at
                 }
             }
        })

        return new Response(
            JSON.stringify({
                success: true,
                pins: pinStatus
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
