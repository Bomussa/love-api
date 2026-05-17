// Supabase Edge Function: queue-enter
// دخول الطابور مع القفل التنافسي والإضافات الحرجة
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { buildCorsHeaders, handleOptions } from '../_shared/cors.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

function getCorsHeaders(req: Request) {
  return buildCorsHeaders(req.headers.get('origin') ?? undefined, 'write');
}

serve(async (req: Request) => {
  const corsHeaders = getCorsHeaders(req);

  if (req.method === 'OPTIONS') {
    return handleOptions(req.headers.get('origin') ?? undefined, 'write');
  }

  try {
    const db = createClient(SUPABASE_URL, SERVICE_KEY);
    const body = await req.json();

    const clinic_id = body.clinic_id || body.clinic;
    const patient_id = body.patient_id || body.user;
    const patient_name = body.patient_name || body.name || patient_id;
    const exam_type = body.exam_type || body.examType || 'general';

    if (!clinic_id || !patient_id) {
      return new Response(
        JSON.stringify({ success: false, error: 'clinic and user are required' }),
        { status: 400, headers: { 'Content-Type': 'application/json', ...corsHeaders } },
      );
    }

    const { data: configData } = await db
      .from('system_config')
      .select('value')
      .eq('key', 'system_enabled')
      .single();

    if (configData && configData.value === false) {
      return new Response(
        JSON.stringify({
          success: false,
          status: 'ABORTED',
          error: 'SYSTEM_DISABLED',
          message: 'النظام متوقف مؤقتًا',
        }),
        { status: 403, headers: { 'Content-Type': 'application/json', ...corsHeaders } },
      );
    }

    const { data: clinicData } = await db
      .from('clinics')
      .select('system_enabled, is_active')
      .eq('id', clinic_id)
      .single();

    if (clinicData && (clinicData.system_enabled === false || clinicData.is_active === false)) {
      return new Response(
        JSON.stringify({
          success: false,
          status: 'ABORTED',
          error: 'CLINIC_DISABLED',
          message: 'العيادة متوقفة مؤقتًا',
        }),
        { status: 403, headers: { 'Content-Type': 'application/json', ...corsHeaders } },
      );
    }

    const { data: result, error: rpcError } = await db.rpc('enter_queue_safe', {
      p_clinic_id: clinic_id,
      p_patient_id: patient_id,
      p_patient_name: patient_name,
      p_exam_type: exam_type,
    });

    if (rpcError) throw rpcError;

    if (result?.status === 'ABORTED') {
      return new Response(
        JSON.stringify({
          success: false,
          status: result.status,
          error: result.reason,
          message: result.reason,
        }),
        { status: 400, headers: { 'Content-Type': 'application/json', ...corsHeaders } },
      );
    }

    return new Response(
      JSON.stringify({
        success: true,
        data: {
          clinic_id: result.clinic,
          patient_id: result.user,
          position: result.number,
          status: result.status,
          message: result.message || 'Entered queue successfully',
        },
      }),
      { headers: { 'Content-Type': 'application/json', ...corsHeaders } },
    );
  } catch (err: any) {
    const errorMessage = err?.message || err?.error?.message || JSON.stringify(err) || String(err);
    console.error('queue-enter error:', errorMessage, err);

    return new Response(
      JSON.stringify({
        success: false,
        status: 'ABORTED',
        error: errorMessage,
      }),
      { status: 500, headers: { 'Content-Type': 'application/json', ...corsHeaders } },
    );
  }
});