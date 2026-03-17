import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

function decodeBase64UrlToBytes(input: string): Uint8Array {
  const padded = input.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(input.length / 4) * 4, '=');
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function decodeBase64UrlUtf8(input: string): string {
  return new TextDecoder().decode(decodeBase64UrlToBytes(input));
}

async function verifyHmacSha256(payload: string, signatureBase64Url: string, secret: string): Promise<boolean> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify']
  );

  return crypto.subtle.verify(
    'HMAC',
    key,
    decodeBase64UrlToBytes(signatureBase64Url),
    new TextEncoder().encode(payload)
  );
}

async function verifyAdminJwt(token: string, secret: string, nowMs = Date.now()): Promise<{ valid: boolean; payload?: Record<string, unknown> }> {
  const [header, payload, signature] = token.split('.');
  if (!header || !payload || !signature) {
    return { valid: false };
  }

  try {
    const parsedHeader = JSON.parse(decodeBase64UrlUtf8(header));
    if (parsedHeader?.alg !== 'HS256' || parsedHeader?.typ !== 'JWT') {
      return { valid: false };
    }

    const verified = await verifyHmacSha256(`${header}.${payload}`, signature, secret);
    if (!verified) {
      return { valid: false };
    }

    const parsedPayload = JSON.parse(decodeBase64UrlUtf8(payload));
    if (!parsedPayload?.sub || !parsedPayload?.exp) {
      return { valid: false };
    }

    const exp = Number(parsedPayload.exp);
    if (!Number.isFinite(exp)) {
      return { valid: false };
    }

    const expMs = exp < 1_000_000_000_000 ? exp * 1000 : exp;
    if (nowMs > expMs) {
      return { valid: false };
    }

    return { valid: true, payload: parsedPayload };
  } catch {
    return { valid: false };
  }
}

function extractToken(req: Request, bodyToken: string | undefined): string | null {
  const authHeader = req.headers.get('authorization') ?? '';
  const [scheme, token] = authHeader.trim().split(/\s+/, 2);
  if (scheme?.toLowerCase() === 'bearer' && token) {
    return token;
  }
  return typeof bodyToken === 'string' && bodyToken.trim() ? bodyToken.trim() : null;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST' && req.method !== 'GET') {
    return new Response(JSON.stringify({ success: false, error: 'Method Not Allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  try {
    let body: Record<string, unknown> = {};
    if (req.method === 'POST') {
      body = await req.json();
    }

    const sessionToken = extractToken(req, body.sessionToken as string | undefined);
    if (!sessionToken) {
      return new Response(JSON.stringify({ success: false, error: 'Missing session token' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const secret = Deno.env.get('ADMIN_AUTH_SECRET') ?? '';
    if (secret.trim().length < 32) {
      return new Response(JSON.stringify({ success: false, error: 'Server admin session configuration is missing' }), {
        status: 503,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const verification = await verifyAdminJwt(sessionToken, secret);
    if (!verification.valid || !verification.payload) {
      return new Response(JSON.stringify({ success: false, error: 'Invalid or expired session token' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const username = String(verification.payload.username ?? 'admin');
    const role = String(verification.payload.role ?? 'admin');
    const permissions = Array.isArray(verification.payload.permissions)
      ? verification.payload.permissions.filter((item) => typeof item === 'string')
      : [];
    const expSeconds = Number(verification.payload.exp);
    const expiresAt = new Date(expSeconds < 1_000_000_000_000 ? expSeconds * 1000 : expSeconds).toISOString();

    return new Response(JSON.stringify({
      success: true,
      role,
      username,
      permissions,
      expiresAt
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('Error:', error);
    return new Response(JSON.stringify({ success: false, error: 'Internal server error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
