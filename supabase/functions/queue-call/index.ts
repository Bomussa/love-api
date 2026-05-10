// Supabase Edge Function: queue-call
// Compatibility wrapper that forwards to canonical queue call function.
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const headers = new Headers(req.headers);
  if (!headers.get('Authorization')) headers.set('Authorization', `Bearer ${SERVICE_KEY}`);

  const target = `${SUPABASE_URL}/functions/v1/call-next-patient`;
  const body = req.method === 'POST' || req.method === 'PUT' ? await req.text() : undefined;
  const response = await fetch(target, { method: req.method, headers, body });

  return new Response(response.body, { status: response.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
});
