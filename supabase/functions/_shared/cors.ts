// Simple CORS helper for Supabase Edge Functions (Deno)
export const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS, PUT, DELETE',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-client-info, apikey',
  'Cache-Control': 'no-cache, no-store, must-revalidate',
  'Content-Type': 'application/json; charset=utf-8',
};

// Fix 29: Added explicit handleOptions for preflight requests
export function handleOptions(req: Request) {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
}

export function isOptions(req: Request) {
  return req.method === 'OPTIONS';
}

export function ok(body: unknown, extraHeaders: Record<string, string> = {}) {
  return new Response(JSON.stringify(body, null, 2), {
    status: 200,
    headers: { ...corsHeaders, ...extraHeaders },
  });
}

// Fix 28: Enhanced error response with unified format
export function errorResponse(message: string, status = 400, details?: unknown) {
  return new Response(JSON.stringify({ 
    success: false, 
    error: message, 
    details,
    timestamp: new Date().toISOString()
  }, null, 2), {
    status,
    headers: corsHeaders,
  });
}

export function badRequest(message: string, details?: unknown) {
  return errorResponse(message, 400, details);
}
