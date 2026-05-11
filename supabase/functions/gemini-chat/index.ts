import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

type GeminiRequestBody = {
  prompt?: string
  system_instruction?: string
  model?: string
  temperature?: number
  max_output_tokens?: number
  top_p?: number
  top_k?: number
}

function pickTextFromCandidates(payload: any): string {
  const candidate = payload?.candidates?.[0]
  const parts = candidate?.content?.parts
  if (!Array.isArray(parts)) return ''

  return parts
    .map((part: any) => (typeof part?.text === 'string' ? part.text : ''))
    .filter(Boolean)
    .join('')
    .trim()
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  if (req.method !== 'POST') {
    return new Response(
      JSON.stringify({ success: false, error: 'Method not allowed' }),
      { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
    const supabaseServiceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    const geminiApiKey = Deno.env.get('GEMINI_API_KEY') ?? ''
    const defaultModel = Deno.env.get('GEMINI_MODEL') ?? 'gemini-1.5-pro'

    if (!supabaseUrl || !supabaseServiceRoleKey) {
      return new Response(
        JSON.stringify({ success: false, error: 'Supabase is not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    if (!geminiApiKey) {
      return new Response(
        JSON.stringify({ success: false, error: 'Missing GEMINI_API_KEY environment variable' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return new Response(
        JSON.stringify({ success: false, error: 'Missing authorization header' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    const token = authHeader.replace(/^Bearer\s+/i, '')
    const supabase = createClient(supabaseUrl, supabaseServiceRoleKey)
    const { data: { user }, error: authError } = await supabase.auth.getUser(token)

    if (authError || !user) {
      return new Response(
        JSON.stringify({ success: false, error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    const body = (await req.json()) as GeminiRequestBody
    const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : ''
    const systemInstruction = typeof body.system_instruction === 'string' ? body.system_instruction.trim() : ''
    const model = (typeof body.model === 'string' && body.model.trim()) ? body.model.trim() : defaultModel

    if (!prompt) {
      return new Response(
        JSON.stringify({ success: false, error: 'prompt is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    if (prompt.length > 12000) {
      return new Response(
        JSON.stringify({ success: false, error: 'prompt is too long' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    const generationConfig = {
      temperature: typeof body.temperature === 'number' ? body.temperature : 0.2,
      maxOutputTokens: typeof body.max_output_tokens === 'number' ? body.max_output_tokens : 1024,
      topP: typeof body.top_p === 'number' ? body.top_p : 0.95,
      topK: typeof body.top_k === 'number' ? body.top_k : 40,
    }

    const payload: Record<string, unknown> = {
      contents: [
        {
          role: 'user',
          parts: [{ text: prompt }],
        },
      ],
      generationConfig,
    }

    if (systemInstruction) {
      payload.systemInstruction = {
        role: 'system',
        parts: [{ text: systemInstruction }],
      }
    }

    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(geminiApiKey)}`

    const geminiResponse = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })

    const raw = await geminiResponse.json().catch(() => ({}))

    if (!geminiResponse.ok) {
      const message = raw?.error?.message || raw?.message || 'Gemini request failed'
      return new Response(
        JSON.stringify({ success: false, error: message, raw }),
        { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    const text = pickTextFromCandidates(raw)

    return new Response(
      JSON.stringify({
        success: true,
        model,
        text,
        raw,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  } catch (error: any) {
    return new Response(
      JSON.stringify({ success: false, error: error?.message || 'Unexpected Gemini error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  }
})
