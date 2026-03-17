import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';
import { scryptSync, timingSafeEqual } from 'node:crypto';
import { Buffer } from 'node:buffer';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function encodeBase64UrlUtf8(value: string): string {
  return bytesToBase64Url(new TextEncoder().encode(value));
}

async function signHmacSha256(payload: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload));
  return bytesToBase64Url(new Uint8Array(signature));
}

async function createAdminJwt(admin: { id: string; username: string; role: string; permissions: string[] }, secret: string, nowMs = Date.now()): Promise<string> {
  const header = encodeBase64UrlUtf8(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = encodeBase64UrlUtf8(JSON.stringify({
    sub: admin.id,
    username: admin.username,
    role: admin.role,
    permissions: admin.permissions,
    exp: Math.floor(nowMs / 1000) + (24 * 60 * 60),
  }));
  const signature = await signHmacSha256(`${header}.${payload}`, secret);
  return `${header}.${payload}.${signature}`;
}

function verifyPasswordHash(password: string, passwordHash: string | null | undefined): boolean {
  if (typeof password !== 'string' || typeof passwordHash !== 'string' || !passwordHash.includes(':')) {
    return false;
  }

  const [salt, storedHash] = passwordHash.split(':');
  if (!salt || !storedHash || storedHash.length !== 128 || !/^[a-f0-9]+$/i.test(storedHash)) {
    return false;
  }

  const derivedHash = scryptSync(password, salt, 64).toString('hex');
  if (derivedHash.length !== storedHash.length) {
    return false;
  }

  return timingSafeEqual(Buffer.from(storedHash, 'hex'), Buffer.from(derivedHash, 'hex'));
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ success: false, error: 'Method Not Allowed' }), {
      status: 405,
      headers: { 'content-type': 'application/json', ...corsHeaders }
    });
  }

  try {
    const body = await req.json();
    const username = typeof body?.username === 'string' ? body.username.trim() : '';
    const password = typeof body?.password === 'string' ? body.password : '';

    if (!username || !password) {
      return new Response(JSON.stringify({ success: false, error: 'Username and password required' }), {
        status: 400,
        headers: { 'content-type': 'application/json', ...corsHeaders }
      });
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    const adminSecret = Deno.env.get('ADMIN_AUTH_SECRET') ?? '';

    if (!supabaseUrl || !supabaseServiceKey) {
      return new Response(JSON.stringify({ success: false, error: 'Server auth configuration is missing' }), {
        status: 503,
        headers: { 'content-type': 'application/json', ...corsHeaders }
      });
    }

    if (adminSecret.trim().length < 32) {
      return new Response(JSON.stringify({ success: false, error: 'Server admin token configuration is missing' }), {
        status: 503,
        headers: { 'content-type': 'application/json', ...corsHeaders }
      });
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { data: admin, error: adminError } = await supabase
      .from('admins')
      .select('id, username, role, permissions, password_hash')
      .eq('username', username)
      .maybeSingle();

    if (adminError || !admin || !verifyPasswordHash(password, admin.password_hash)) {
      return new Response(JSON.stringify({ success: false, error: 'Invalid credentials' }), {
        status: 401,
        headers: { 'content-type': 'application/json', ...corsHeaders }
      });
    }

    const role = admin.role || 'admin';
    const permissions = Array.isArray(admin.permissions)
      ? admin.permissions.filter((item) => typeof item === 'string')
      : [];

    const token = await createAdminJwt({
      id: String(admin.id),
      username: admin.username,
      role,
      permissions,
    }, adminSecret);

    return new Response(JSON.stringify({
      success: true,
      token,
      user: {
        id: admin.id,
        username: admin.username,
        role,
        permissions
      }
    }), {
      headers: { 'content-type': 'application/json', ...corsHeaders }
    });
  } catch (err) {
    console.error('Admin login error:', err);
    return new Response(JSON.stringify({ success: false, error: 'Internal server error' }), {
      status: 500,
      headers: { 'content-type': 'application/json', ...corsHeaders }
    });
  }
});
