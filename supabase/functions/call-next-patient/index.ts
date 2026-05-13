import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { assertPinValidForQueueAction } from '../_shared/pin-service.js';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    );

    const { clinic_id, pin } = await req.json();
    const normalizedClinicId = typeof clinic_id === 'string' ? clinic_id.trim() : '';
    const normalizedPin = typeof pin === 'string' ? pin.trim() : '';

    if (!normalizedClinicId || !normalizedPin) {
      throw new Error('Missing clinic_id or pin');
    }

    const isPinValid = await assertPinValidForQueueAction(
      supabaseClient,
      normalizedClinicId,
      normalizedPin,
    );

    if (!isPinValid) {
      throw new Error('Invalid or expired PIN');
    }

    const { data, error } = await supabaseClient.rpc('call_next_patient_safe', {
      p_clinic_id: normalizedClinicId,
      p_operator_pin: normalizedPin,
    });

    if (error) {
      throw error;
    }

    const response = data ?? {};
    const success = response.status === 'OK';

    return new Response(
      JSON.stringify({
        success,
        data: response,
        message: response.message ?? null,
      }),
      {
        status: success ? 200 : 400,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
        },
      },
    );
  } catch (error) {
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message,
      }),
      {
        status: 400,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
        },
      },
    );
  }
});
