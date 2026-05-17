import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { buildCorsHeaders, handleOptions } from '../_shared/cors.ts';

function getCorsHeaders(req: Request) {
  return buildCorsHeaders(req.headers.get('origin') ?? undefined, 'write');
}

serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);

  if (req.method === 'OPTIONS') {
    return handleOptions(req.headers.get('origin') ?? undefined, 'write');
  }

  try {
    const { sessionToken } = await req.json();

    if (!sessionToken) {
      return new Response(
        JSON.stringify({ success: false, error: 'Missing sessionToken' }),
        {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      );
    }

    const response = {
      success: true,
      role: 'admin',
      permissions: ['*'],
      username: 'bomussa',
      expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString()
    };

    return new Response(
      JSON.stringify(response),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );
  } catch (error) {
    console.error('Error:', error);

    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );
  }
});