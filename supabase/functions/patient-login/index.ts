import { serve } from "https://deno.land/std/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { buildCorsHeaders, handleOptions } from '../_shared/cors.ts';

function getCorsHeaders(req: Request) {
  return buildCorsHeaders(req.headers.get('origin') ?? undefined, 'write');
}

serve(async (req: Request) => {
  const corsHeaders = getCorsHeaders(req);

  if (req.method === 'OPTIONS') {
    return handleOptions(req.headers.get('origin') ?? undefined, 'write');
  }

  try {
    if (req.method !== 'POST') {
      throw new Error('Method not allowed');
    }

    const { militaryId, name, examType } = await req.json();

    if (!militaryId || !name) {
      throw new Error('Military ID and name are required');
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { data: existingPatient } = await supabase
      .from('patients')
      .select('*')
      .eq('military_id', militaryId)
      .single();

    let patient;
    if (existingPatient) {
      patient = existingPatient;
    } else {
      const { data: newPatient, error: createError } = await supabase
        .from('patients')
        .insert({
          military_id: militaryId,
          name: name,
          exam_type: examType || 'comprehensive',
          created_at: new Date().toISOString()
        })
        .select()
        .single();

      if (createError) throw createError;
      patient = newPatient;
    }

    const token = `mmc_${patient.id}_${Date.now()}`;

    const { error: sessionError } = await supabase
      .from('patient_sessions')
      .insert({
        patient_id: patient.id,
        token: token,
        expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
      });

    if (sessionError) throw sessionError;

    return new Response(
      JSON.stringify({
        success: true,
        token: token,
        patient: {
          id: patient.id,
          name: patient.name,
          militaryId: patient.military_id,
          examType: patient.exam_type
        }
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    );

  } catch (error) {
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400,
      }
    );
  }
});