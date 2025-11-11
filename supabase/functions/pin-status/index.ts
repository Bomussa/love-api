import { serve } from "https://deno.land/std/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'GET, OPTIONS'
};

serve(async (req: Request) => {
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders });
    }

    try {
        if (req.method !== 'GET') {
            throw new Error('Method not allowed');
        }

        const url = new URL(req.url);
        const clinic = url.searchParams.get('clinic');

        if (!clinic) {
            throw new Error('Clinic parameter is required');
        }

        // Create Supabase client
        const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
        const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
        const supabase = createClient(supabaseUrl, supabaseServiceKey);

        // Get today's date
        const today = new Date().toISOString().split('T')[0];

        // Get or create PIN for today
        let { data: pin, error: pinError } = await supabase
            .from('pins')
            .select('pin, created_at, expires_at')
            .eq('clinic', clinic)
            .eq('date', today)
            .single();

        if (pinError && pinError.code !== 'PGRST116') { // Not found error
            throw pinError;
        }

        // If no PIN exists for today, generate one
        if (!pin) {
            const newPin = Math.floor(100000 + Math.random() * 900000).toString(); // 6-digit PIN
            const expiresAt = new Date();
            expiresAt.setDate(expiresAt.getDate() + 1); // Expires tomorrow

            const { data: createdPin, error: createError } = await supabase
                .from('pins')
                .insert({
                    clinic: clinic,
                    pin: newPin,
                    date: today,
                    created_at: new Date().toISOString(),
                    expires_at: expiresAt.toISOString()
                })
                .select('pin, created_at, expires_at')
                .single();

            if (createError) throw createError;
            pin = createdPin;
        }

        // Check if PIN is expired
        const isExpired = pin.expires_at && new Date(pin.expires_at) < new Date();

        return new Response(
            JSON.stringify({
                success: true,
                clinic: clinic,
                pin: pin.pin,
                createdAt: pin.created_at,
                expiresAt: pin.expires_at,
                isExpired: isExpired,
                isValid: !isExpired
            }),
            {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                status: 200,
            }
        );

    } catch (error) {
        return new Response(
            JSON.stringify({
                success: false,
                error: error.message
            }),
            {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                status: 400,
            }
        );
    }
});