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

        // Get current queue for the clinic
        const { data: queue, error: queueError } = await supabase
            .from('queues')
            .select(`
        id,
        queue_number,
        position,
        priority,
        status,
        entered_at,
        patients(name, military_id)
      `)
            .eq('clinic', clinic)
            .in('status', ['waiting', 'called'])
            .order('position', { ascending: true });

        if (queueError) throw queueError;

        // Get clinic statistics
        const { count: totalWaiting } = await supabase
            .from('queues')
            .select('*', { count: 'exact' })
            .eq('clinic', clinic)
            .eq('status', 'waiting');

        const { count: totalCalled } = await supabase
            .from('queues')
            .select('*', { count: 'exact' })
            .eq('clinic', clinic)
            .eq('status', 'called');

        const { count: totalCompleted } = await supabase
            .from('queues')
            .select('*', { count: 'exact' })
            .eq('clinic', clinic)
            .eq('status', 'completed');

        // Current patient being served
        const { data: currentPatient } = await supabase
            .from('queues')
            .select(`
        queue_number,
        patients(name)
      `)
            .eq('clinic', clinic)
            .eq('status', 'called')
            .order('position', { ascending: true })
            .limit(1)
            .single();

        return new Response(
            JSON.stringify({
                success: true,
                clinic: clinic,
                queue: queue || [],
                statistics: {
                    waiting: totalWaiting || 0,
                    called: totalCalled || 0,
                    completed: totalCompleted || 0,
                    total: (totalWaiting || 0) + (totalCalled || 0) + (totalCompleted || 0)
                },
                currentPatient: currentPatient || null,
                lastUpdated: new Date().toISOString()
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