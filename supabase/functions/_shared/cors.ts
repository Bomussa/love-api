// Shared CORS helper for Supabase Edge Functions (Deno)
const ALLOWED_ORIGIN_PATTERNS: RegExp[] = [
  /^https:\/\/(www\.)?mmc-mms\.com$/,
  /^https:\/\/staging\.mmc-mms\.com$/,
  /^http:\/\/localhost(?::\d+)?$/,
  /^http:\/\/127\.0\.0\.1(?::\d+)?$/,
];

const ROUTE_CATEGORIES: Record<string, { methods: string; headers: string }> = {
  status: {
    methods: 'GET, OPTIONS',
    headers: 'Content-Type, Authorization, apikey, x-client-info',
  },
  write: {
    methods: 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    headers: 'Content-Type, Authorization, apikey, x-client-info, x-requested-with',
  },
};

export function isAllowedOrigin(origin?: string | null): boolean {
  if (!origin) return false;
  return ALLOWED_ORIGIN_PATTERNS.some((pattern) => pattern.test(origin));
}

export function buildCorsHeaders(origin?: string | null, category: string = 'write'): Record<string, string> {
  const routePolicy = ROUTE_CATEGORIES[category] ?? ROUTE_CATEGORIES.write;
  const headers: Record<string, string> = {
    'Access-Control-Allow-Methods': routePolicy.methods,
    'Access-Control-Allow-Headers': routePolicy.headers,
    'Access-Control-Max-Age': '86400',
    'Cache-Control': 'no-cache, no-store, must-revalidate',
    'Content-Type': 'application/json; charset=utf-8',
    'Vary': 'Origin',
  };

  if (isAllowedOrigin(origin)) {
    headers['Access-Control-Allow-Origin'] = origin;
  }

  return headers;
}

export const corsHeaders: Record<string, string> = buildCorsHeaders(null, 'write');

export function isOptions(req: Request) {
  return req.method === 'OPTIONS';
}

export function ok(body: unknown, extraHeaders: Record<string, string> = {}, origin?: string | null, category = 'write') {
  return new Response(JSON.stringify(body, null, 2), {
    status: 200,
    headers: { ...buildCorsHeaders(origin, category), ...extraHeaders },
  });
}

export function badRequest(message: string, details?: unknown, origin?: string | null, category = 'write') {
  return new Response(JSON.stringify({ success: false, error: message, details }, null, 2), {
    status: 400,
    headers: buildCorsHeaders(origin, category),
  });
}

export function handleOptions(origin?: string | null, category = 'write') {
  return new Response(null, { status: 204, headers: buildCorsHeaders(origin, category) });
}

export function corsJsonResponse(body: unknown, status = 200, origin?: string | null, category = 'write') {
  return new Response(JSON.stringify(body), {
    status,
    headers: buildCorsHeaders(origin, category),
  });
}

export function corsErrorResponse(message: string, status = 400, origin?: string | null, category = 'write') {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: buildCorsHeaders(origin, category),
  });
}
