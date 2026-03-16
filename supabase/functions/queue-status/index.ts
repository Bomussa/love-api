// Supabase Edge Function: queue-status
// Get current queue status for a clinic
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { QUEUE_STATE_ORDER, assertQueueState, normalizeQueueState } from '../_shared/queue-state.js';
import { buildQueueStatusPayload } from './read-model.js';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const corsHeaders = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET,POST,OPTIONS',
  'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const db = createClient(SUPABASE_URL, SERVICE_KEY);
    const { searchParams } = new URL(req.url);
    const clinic_id = searchParams.get('clinic_id') || searchParams.get('clinicId');

    if (!clinic_id) {
      return new Response(
        JSON.stringify({ success: false, error: 'clinic_id parameter required' }),
        { status: 400, headers: { 'content-type': 'application/json', ...corsHeaders } },
      );
    }

    // Primary source: public.queues (canonical table with official statuses)
    const { data: canonicalQueue, error: canonicalError } = await db
      .from('queues')
      .select('id, queue_number_int, display_number, status, entered_at, called_at, completed_at, patient_id')
      .eq('clinic_id', clinic_id)
      .in('status', QUEUE_STATE_ORDER)
      .order('queue_number_int', { ascending: true, nullsFirst: false });

    if (canonicalError) throw canonicalError;

    // Fallback source: public.unified_queue (legacy path), mapped to canonical statuses
    let queueList = canonicalQueue ?? [];
    if (queueList.length === 0) {
      const { data: legacyQueue, error: legacyError } = await db
        .from('unified_queue')
        .select('id, queue_position, display_number, status, entered_at, called_at, completed_at, patient_id')
        .eq('clinic_id', clinic_id)
        .order('queue_position', { ascending: true, nullsFirst: false });

      if (legacyError) throw legacyError;

      queueList = (legacyQueue ?? []).map((row: any) => ({
        ...row,
        status: assertQueueState(normalizeQueueState(row.status), 'legacy queue status'),
      }));
    }

    return new Response(
      JSON.stringify({
        success: true,
        data: buildQueueStatusPayload(clinic_id, queueList),
      }),
      { headers: { 'content-type': 'application/json', ...corsHeaders } },
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ success: false, error: String(err) }),
      { status: 400, headers: { 'content-type': 'application/json', ...corsHeaders } },
    );
  }
});
