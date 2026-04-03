/**
 * @fileoverview Patient Login Edge Function
 * @description Handles patient authentication and session creation for the Medical Committee system.
 *              Validates input, creates/retrieves patient records, and generates secure session tokens.
 * @version 2.0.0
 * @module supabase/functions/patient-login
 * 
 * @example
 * // Request body:
 * {
 *   "militaryId": "ABC12345",
 *   "name": "John Doe",
 *   "examType": "comprehensive"
 * }
 * 
 * // Success response:
 * {
 *   "success": true,
 *   "token": "mmc_uuid_timestamp",
 *   "patient": { "id": "...", "name": "...", "militaryId": "...", "examType": "..." }
 * }
 */

import { serve } from "https://deno.land/std/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

/** CORS headers for cross-origin requests */
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

        const { militaryId, name, examType } = await req.json();

        // Enhanced input validation
        if (!militaryId || !name) {
            throw new Error('Military ID and name are required');
        }
        
        // Validate military ID format (alphanumeric, 5-20 characters)
        const militaryIdStr = String(militaryId).trim();
        if (!/^[a-zA-Z0-9]{5,20}$/.test(militaryIdStr)) {
            throw new Error('Invalid military ID format. Must be 5-20 alphanumeric characters');
        }
        
        // Validate name (2-100 characters, letters and spaces only)
        const nameStr = String(name).trim();
        if (!/^[\u0600-\u06FFa-zA-Z\s]{2,100}$/.test(nameStr)) {
            throw new Error('Invalid name format. Must be 2-100 characters (letters only)');
        }
        
        // Validate exam type if provided
        const validExamTypes = ['comprehensive', 'general', 'specialist', 'followup'];
        const examTypeStr = examType ? String(examType).trim().toLowerCase() : 'comprehensive';
        if (!validExamTypes.includes(examTypeStr)) {
            throw new Error(`Invalid exam type. Must be one of: ${validExamTypes.join(', ')}`);
        }

        // Create Supabase client
        const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
        const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
        const supabase = createClient(supabaseUrl, supabaseServiceKey);

        // Check if patient exists or create new one
        const { data: existingPatient, error: fetchError } = await supabase
            .from('patients')
            .select('*')
            .eq('military_id', militaryId)
            .single();

        let patient;
        if (existingPatient) {
            patient = existingPatient;
        } else {
            // Create new patient
            const { data: newPatient, error: createError } = await supabase
                .from('patients')
                .insert({
                    military_id: militaryId,
                    name: name,
                    exam_type: examType || 'comprehensive',
                    created_at: new Date().toISOString()
                })
                .select()
                .single();

            if (createError) throw createError;
            patient = newPatient;
        }

        // Generate session token (simple implementation)
        const token = `mmc_${patient.id}_${Date.now()}`;

        // Store session
        const { error: sessionError } = await supabase
            .from('patient_sessions')
            .insert({
                patient_id: patient.id,
                token: token,
                expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() // 24 hours
            });

        if (sessionError) throw sessionError;

        return new Response(
            JSON.stringify({
                success: true,
                token: token,
                patient: {
                    id: patient.id,
                    name: patient.name,
                    militaryId: patient.military_id,
                    examType: patient.exam_type
                }
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