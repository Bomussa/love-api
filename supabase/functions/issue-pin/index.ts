
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

    const { clinic_id } = await req.json()

    if (!clinic_id) {
      throw new Error('Missing clinic_id')
    }

    // Generate random 2-digit PIN (10-99)
    const pin = String(Math.floor(Math.random() * 90) + 10)
    
    // Set expiration to end of day
    const expiresAt = new Date()
    expiresAt.setHours(23, 59, 59, 999)

    // Insert into pins table
    const { data: pinRecord, error: pinError } = await supabaseClient
      .from('pins')
      .insert({
        clinic_code: clinic_id,
        pin: pin,
        is_active: true,
        expires_at: expiresAt.toISOString()
      })
      .select()
      .single()

    if (pinError) throw pinError

    // Update clinic table (denormalized)
    const { error: clinicError } = await supabaseClient
      .from('clinics')
      .update({
        pin_code: pin,
        pin_expires_at: expiresAt.toISOString(),
        updated_at: new Date().toISOString()
      })
      .eq('id', clinic_id)

    if (clinicError) throw clinicError

    return new Response(
      JSON.stringify({
        success: true,
        data: pinRecord,
        message: 'PIN issued successfully'
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
