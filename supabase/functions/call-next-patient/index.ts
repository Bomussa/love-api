
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
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    const { clinic_id, pin } = await req.json()

    if (!clinic_id || !pin) {
      throw new Error('Missing clinic_id or pin')
    }

    // 1. Verify PIN
    // Check 'pins' table for daily PIN first (Preferred)
    const today = new Date().toISOString().split('T')[0]
    const { data: pinRecord, error: pinError } = await supabaseClient
      .from('pins')
      .select('*')
      .eq('clinic_code', clinic_id) // Assuming clinic_code matches clinic_id or need to look up
      .eq('pin', pin)
      .eq('is_active', true)
      .gte('expires_at', new Date().toISOString())
      .limit(1)
      .maybeSingle()
    
    // Fallback to checking 'clinics' table if not found in 'pins' (Legacy/Denormalized support)
    let isPinValid = !!pinRecord
    
    if (!isPinValid) {
         const { data: clinic, error: clinicError } = await supabaseClient
        .from('clinics')
        .select('pin_code, pin_expires_at')
        .eq('id', clinic_id)
        .single()
        
        if (clinic && clinic.pin_code === pin) {
             const expires = new Date(clinic.pin_expires_at)
             if (expires > new Date()) {
                 isPinValid = true
             }
        }
    }

    if (!isPinValid) {
      throw new Error('Invalid or expired PIN')
    }

    // 2. Find Next Patient
    const { data: nextPatient, error: queueError } = await supabaseClient
      .from('queue')
      .select('*')
      .eq('clinic_id', clinic_id)
      .eq('status', 'waiting')
      .order('position', { ascending: true })
      .limit(1)
      .maybeSingle()

    if (!nextPatient) {
      return new Response(
        JSON.stringify({ success: false, message: 'No patients waiting' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // 3. Update Status to 'called'
    const { data: updatedQueue, error: updateError } = await supabaseClient
      .from('queue')
      .update({
        status: 'called',
        called_at: new Date().toISOString()
      })
      .eq('id', nextPatient.id)
      .select()
      .single()

    if (updateError) throw updateError

    // 4. Trigger Realtime Event (SSE/Broadcast)
    // Insert into events table
    await supabaseClient.from('events').insert({
        event_type: 'YOUR_TURN',
        clinic_id: clinic_id,
        patient_id: nextPatient.patient_id,
        payload: {
            ticket: nextPatient.ticket_number,
            clinic: clinic_id
        }
    })

    return new Response(
      JSON.stringify({
        success: true,
        data: updatedQueue,
        message: `Calling ticket ${nextPatient.ticket_number}`
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
