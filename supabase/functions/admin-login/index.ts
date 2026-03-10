import { serve } from "https://deno.land/std@0.168.0/http/server.ts"

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
}

// Hardcoded admin credentials (in production, use database)
const ADMIN_CREDENTIALS = {
    username: 'bomussa',
    password: '14490'
}

serve(async (req) => {
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders })
    }

    try {
        const { username, password } = await req.json()

        if (!username || !password) {
            return new Response(
                JSON.stringify({ success: false, error: 'Missing username or password' }),
                { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            )
        }

        // Verify credentials
        if (username !== ADMIN_CREDENTIALS.username || password !== ADMIN_CREDENTIALS.password) {
            return new Response(
                JSON.stringify({ success: false, error: 'Invalid credentials' }),
                { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            )
        }

        const sessionToken = `sess_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`

        const response = {
            success: true,
            sessionToken: sessionToken,
            sessionId: `user_${Date.now()}`,
            username: username,
            role: 'admin',
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
