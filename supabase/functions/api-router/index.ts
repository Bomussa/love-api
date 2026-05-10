// @ts-nocheck
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

import { getRoute, INTERNAL_FUNCTION_ALLOWLIST, isUnauthorizedForUserAuth, resolvePath, type RouteConfig } from './router-core.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  )

  try {
    const url = new URL(req.url)
    const path = resolvePath(url)
    const route = getRoute(path, req.method)

    if (!route) {
      return new Response(
        JSON.stringify({ success: false, error: `Route not found: ${path}` }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    const authHeader = req.headers.get('Authorization')
    if (isUnauthorizedForUserAuth(route, authHeader)) {
      console.warn(
        JSON.stringify({
          event: 'api_router_unauthorized',
          path,
          method: req.method,
          authMode: route.authMode,
          reason: 'missing_or_invalid_bearer',
        }),
      )
      return new Response(
        JSON.stringify({ success: false, error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    return await forwardToFunction(route, req, path)
  } catch (error) {
    console.error(`[api-router] Error:`, error)
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  }
})

async function forwardToFunction(route: RouteConfig, req: Request, path: string): Promise<Response> {
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  const targetUrl = `${supabaseUrl}/functions/v1/${route.functionName}`

  const headers = new Headers(req.headers)
  let forwardedAuthMode = 'passthrough'

  if (route.authMode === 'internal-admin') {
    if (!INTERNAL_FUNCTION_ALLOWLIST.has(route.functionName)) {
      throw new Error(`Internal route is not allowlisted: ${route.functionName}`)
    }
    headers.set('Authorization', `Bearer ${serviceKey}`)
    forwardedAuthMode = 'service-role'
  }

  console.info(
    JSON.stringify({
      event: 'api_router_forward',
      path,
      method: req.method,
      functionName: route.functionName,
      routeAuthMode: route.authMode,
      forwardedAuthMode,
    }),
  )

  try {
    const body = req.method === 'POST' || req.method === 'PUT' ? await req.text() : undefined
    const response = await fetch(targetUrl, {
      method: req.method,
      headers,
      body,
    })

    return new Response(response.body, {
      status: response.status,
      headers: response.headers,
    })
  } catch (e) {
    throw new Error(`Failed to invoke ${route.functionName}: ${e.message}`)
  }
}
