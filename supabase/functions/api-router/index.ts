// @ts-nocheck
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { hasAuthOrSession, resolveForwardAuthHeader } from './auth.ts'
import { buildCorsHeaders, handleOptions } from '../_shared/cors.ts'

const INTERNAL_API_KEY = Deno.env.get('INTERNAL_API_KEY') ?? ''

// Narrow allowlist for service-role invocation only.
const serviceRoleAllowlist = new Set<string>([
  'api-v1-status',
])

serve(async (req) => {
  const origin = req.headers.get('origin') ?? undefined
  const corsHeaders = buildCorsHeaders(origin, 'write')

  if (req.method === 'OPTIONS') {
    return handleOptions(origin, 'write')
  }

  try {
    const url = new URL(req.url)
    let path = url.pathname.replace(/^\/api\/v1\//, '').replace(/^\/api-router\//, '')
    const queryPath = url.searchParams.get('path')
    if (queryPath) path = queryPath

    console.log(`[api-router] Request path: ${path}, Method: ${req.method}`)

    if (path === 'queue/enter' && req.method === 'POST') {
      return await forwardToFunction('queue-enter', req, corsHeaders)
    }

    if (path === 'patient/login' && req.method === 'POST') {
      return await forwardToFunction('patient-login', req, corsHeaders)
    }

    if (path === 'queue/call' && req.method === 'POST') {
      return await forwardToFunction('call-next-patient', req, corsHeaders)
    }

    if (path === 'pin/generate' && req.method === 'POST') {
      return await forwardToFunction('issue-pin', req, corsHeaders)
    }

    if (path === 'queue/status' && req.method === 'GET') {
      return await forwardToFunction('queue-status', req, corsHeaders)
    }

    if (path === 'events/stream' && req.method === 'GET') {
      return await forwardToFunction('events-stream', req, corsHeaders)
    }

    if (path === 'ai/chat' && req.method === 'POST') {
      if (!hasAuthOrSession(req)) {
        return unauthorized('ai/chat', req.method, corsHeaders)
      }

      return await forwardToFunction('gemini-chat', req, corsHeaders)
    }

    if (path === 'admin/status' && req.method === 'GET') {
      if (!hasAuthOrSession(req)) {
        return unauthorized('admin/status', req.method, corsHeaders)
      }
      return await forwardToFunction('api-v1-status', req, corsHeaders)
    }

    if (path === 'pin/status' && req.method === 'GET') {
      return await forwardToFunction('pin-status', req, corsHeaders)
    }

    if (path === 'admin/login' && req.method === 'POST') {
      return await forwardToFunction('admin-login', req, corsHeaders)
    }

    if (path === 'admin/session/verify' && req.method === 'POST') {
      if (!hasAuthOrSession(req)) {
        return unauthorized('admin/session/verify', req.method, corsHeaders)
      }
      return await forwardToFunction('admin-session-verify', req, corsHeaders)
    }

    return new Response(
      JSON.stringify({ success: false, error: `Route not found: ${path}` }),
      { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  } catch (error) {
    console.error('[api-router] Error:', error)
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  }
})

function unauthorized(path: string, method: string, corsHeaders: Record<string, string>): Response {
  console.warn(`[api-router][security] Rejected unauthorized admin request. path=${path} method=${method}`)
  return new Response(
    JSON.stringify({ success: false, error: 'Unauthorized' }),
    { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
  )
}

async function forwardToFunction(functionName: string, req: Request, corsHeaders: Record<string, string>): Promise<Response> {
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  const targetUrl = `${supabaseUrl}/functions/v1/${functionName}`

  console.log(`[api-router] Forwarding to function: ${functionName}`)

  try {
    const headers = new Headers(req.headers)
    const authResolution = resolveForwardAuthHeader(functionName, req, serviceRoleAllowlist, INTERNAL_API_KEY, serviceKey)

    if (authResolution.kind === 'unauthorized_internal') {
      console.warn(`[api-router][security] Rejected service-role escalation. function=${functionName}`)
      return new Response(
        JSON.stringify({ success: false, error: 'Unauthorized internal request' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    if (authResolution.authorization) {
      headers.set('Authorization', authResolution.authorization)
    } else {
      headers.delete('Authorization')
    }

    const body = req.method === 'POST' || req.method === 'PUT' ? await req.text() : undefined

    const response = await fetch(targetUrl, {
      method: req.method,
      headers,
      body,
    })

    const responseHeaders = new Headers(response.headers)
    Object.entries(corsHeaders).forEach(([key, value]) => responseHeaders.set(key, value))

    return new Response(response.body, {
      status: response.status,
      headers: responseHeaders,
    })
  } catch (e) {
    throw new Error(`Failed to invoke ${functionName}: ${e.message}`)
  }
}
