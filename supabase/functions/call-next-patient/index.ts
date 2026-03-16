import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { assertQueueTransition } from '../_shared/queue-state.js'

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

    // 1. Verify PIN (pins table first, then clinics table fallback)
    const { data: pinRecord } = await supabaseClient
      .from('pins')
      .select('*')
      .eq('clinic_code', clinic_id)
      .eq('pin', pin)
      .eq('is_active', true)
      .gte('expires_at', new Date().toISOString())
      .limit(1)
      .maybeSingle()

    let isPinValid = !!pinRecord

    if (!isPinValid) {
      const { data: clinic } = await supabaseClient
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

    // 2. Find next waiting patient from canonical queues table
    const { data: nextPatient, error: queueError } = await supabaseClient
      .from('queues')
      .select('id, clinic_id, patient_id, queue_number_int, display_number, queue_number, status')
      .eq('clinic_id', clinic_id)
      .eq('status', 'waiting')
      .order('queue_number_int', { ascending: true, nullsFirst: false })
      .limit(1)
      .maybeSingle()

    if (queueError) throw queueError

    if (!nextPatient) {
      return new Response(
        JSON.stringify({ success: false, message: 'No patients waiting' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // 3. Update status to called (official state machine: waiting -> called)
    assertQueueTransition(nextPatient.status, 'called', 'call-next-patient')
    const { data: updatedQueue, error: updateError } = await supabaseClient
      .from('queues')
      .update({
        status: 'called',
        called_at: new Date().toISOString()
      })
      .eq('id', nextPatient.id)
      .select('*')
      .single()

    if (updateError) throw updateError

    // 4. Broadcast event
    const ticket = nextPatient.display_number ?? nextPatient.queue_number_int ?? nextPatient.queue_number ?? null
    await supabaseClient.from('events').insert({
      event_type: 'YOUR_TURN',
      clinic_id,
      patient_id: nextPatient.patient_id,
      payload: { ticket, clinic: clinic_id }
    })

    return new Response(
      JSON.stringify({
        success: true,
        data: updatedQueue,
        message: ticket ? `Calling ticket ${ticket}` : 'Calling next patient'
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
