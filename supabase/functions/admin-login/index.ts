import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
}

serve(async (req) => {
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders })
    }

    const supabaseClient = createClient(
        Deno.env.get('SUPABASE_URL') ?? '',
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    try {
        const { username, password } = await req.json()

        if (!username || !password) {
            return new Response(
                JSON.stringify({ success: false, error: 'Missing username or password' }),
                { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            )
        }

        // Call the admin_auth_login function
        const { data, error } = await supabaseClient
            .rpc('admin_auth_login', {
                p_username: username,
                p_password: password,
                p_ip_address: req.headers.get('x-forwarded-for') || 'unknown'
            })

        if (error) {
            console.error('RPC Error:', error)
            return new Response(
                JSON.stringify({ success: false, error: 'Invalid credentials' }),
                { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            )
        }

        if (!data || !data[0] || !data[0].success) {
            return new Response(
                JSON.stringify({ success: false, error: 'Invalid credentials' }),
                { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            )
        }

        const result = data[0]
        const sessionToken = `sess_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`

        const response = {
            success: true,
            sessionToken: sessionToken,
            sessionId: result.user_id,
            username: result.username,
            role: result.role || 'admin',
            permissions: ['*'],
            loginTime: new Date().toISOString(),
            expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString()
        }

        return new Response(
            JSON.stringify(response),
            { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
    } catch (error) {
        console.error('Error:', error)
        return new Response(
            JSON.stringify({ success: false, error: 'Server error' }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
    }
})
