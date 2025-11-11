import { serve } from "https://deno.land/std/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

serve(async (req: Request) => {
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders });
    }

    try {
        if (req.method !== 'POST') {
            throw new Error('Method not allowed');
        }

        // Get authorization token
        const authHeader = req.headers.get('authorization');
        if (!authHeader) {
            throw new Error('Authorization required');
        }

        const token = authHeader.replace('Bearer ', '');
        const { clinic, priority = 'normal' } = await req.json();

        if (!clinic) {
            throw new Error('Clinic is required');
        }

        // Create Supabase client
        const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
        const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
        const supabase = createClient(supabaseUrl, supabaseServiceKey);

        // Verify token and get patient
        const { data: session, error: sessionError } = await supabase
            .from('patient_sessions')
            .select('patient_id, patients(id, name, military_id)')
            .eq('token', token)
            .gt('expires_at', new Date().toISOString())
            .single();

        if (sessionError || !session) {
            throw new Error('Invalid or expired token');
        }

        // Generate queue number (UUID-based)
        const queueNumber = `${clinic.toUpperCase()}-${crypto.randomUUID().slice(0, 8)}`;

        // Get current queue position
        const { count } = await supabase
            .from('queues')
            .select('*', { count: 'exact' })
            .eq('clinic', clinic)
            .eq('status', 'waiting');

        const position = (count || 0) + 1;

        // Add to queue
        const { data: queueEntry, error: queueError } = await supabase
            .from('queues')
            .insert({
                patient_id: session.patient_id,
                clinic: clinic,
                queue_number: queueNumber,
                position: position,
                priority: priority,
                status: 'waiting',
                entered_at: new Date().toISOString()
            })
            .select()
            .single();

        if (queueError) throw queueError;

        // Log activity
        await supabase
            .from('queue_history')
            .insert({
                patient_id: session.patient_id,
                clinic: clinic,
                action: 'entered',
                queue_number: queueNumber,
                timestamp: new Date().toISOString()
            });

        return new Response(
            JSON.stringify({
                success: true,
                queueNumber: queueNumber,
                position: position,
                clinic: clinic,
                estimatedWait: position * 5, // Rough estimate: 5 minutes per patient
                patient: session.patients
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