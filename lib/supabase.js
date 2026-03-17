/**
 * Supabase Client Wrapper (Unified & Fixed)
 * This file provides a consistent client for connecting to Supabase across all API endpoints.
 */

import { createClient } from '@supabase/supabase-js';

/**
 * Creates a Supabase client instance.
 * @param {Object} env - Environment variables.
 * @returns {Object} Supabase client.
 */
export function getSupabaseClient(env = process.env) {
  const supabaseUrl = env.SUPABASE_URL;
  const supabaseKey = env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    throw new Error('Missing required backend Supabase environment variables: SUPABASE_URL and/or SUPABASE_SERVICE_ROLE_KEY. Do not use client key fallbacks on the server.');
  }

  return createClient(supabaseUrl, supabaseKey, {
    auth: {
      autoRefreshToken: true,
      persistSession: false,
    },
    db: {
      schema: 'public',
    },
  });
}

/**
 * Get all active items in the queue.
 */
export async function getActiveQueues(supabase, clinicId = null) {
  let query = supabase
    .from('queues')
    .select('*')
    .in('status', ['waiting', 'serving', 'called'])
    .order('display_number', { ascending: true });

  if (clinicId) {
    query = query.eq('clinic_id', clinicId);
  }

  const { data, error } = await query;
  if (error) throw new Error(`Failed to fetch queues: ${error.message}`);
  return data;
}

/**
 * Add a patient to the queue.
 */
export async function addToQueue(supabase, patientData) {
  const {
    patient_id, clinic_id, exam_type, is_priority = false, priority_reason = null
  } = patientData;

  // Get next display_number
  const { data: lastEntry } = await supabase
    .from('queues')
    .select('display_number')
    .eq('clinic_id', clinic_id)
    .order('display_number', { ascending: false })
    .limit(1)
    .maybeSingle();

  const nextNumber = lastEntry ? lastEntry.display_number + 1 : 1;

  const { data, error } = await supabase
    .from('queues')
    .insert({
      patient_id,
      clinic_id,
      exam_type,
      status: 'waiting',
      display_number: nextNumber,
      is_priority,
      priority_reason,
      entered_at: new Date().toISOString()
    })
    .select()
    .single();

  if (error) throw new Error(`Failed to add to queue: ${error.message}`);
  return data;
}

/**
 * Call the next patient for a clinic.
 */
export async function callNextPatient(supabase, clinicId) {
  const { data: nextPatient, error: fetchError } = await supabase
    .from('queues')
    .select('*')
    .eq('clinic_id', clinicId)
    .eq('status', 'waiting')
    .order('display_number', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (fetchError || !nextPatient) return null;

  const { data, error } = await supabase
    .from('queues')
    .update({
      status: 'serving',
      called_at: new Date().toISOString(),
    })
    .eq('id', nextPatient.id)
    .select()
    .single();

  if (error) throw new Error(`Failed to call patient: ${error.message}`);
  return data;
}

/**
 * Complete patient examination.
 */
export async function completePatient(supabase, queueId, pin = null) {
  const { data, error } = await supabase
    .from('queues')
    .update({
      status: 'completed',
      completed_at: new Date().toISOString(),
      completed_by_pin: pin
    })
    .eq('id', queueId)
    .select()
    .single();

  if (error) throw new Error(`Failed to complete patient: ${error.message}`);
  return data;
}

/**
 * Get patient position.
 */
export async function getPatientPosition(supabase, patientId) {
  const { data, error } = await supabase
    .from('queues')
    .select('display_number, status, clinic_id')
    .eq('patient_id', patientId)
    .neq('status', 'completed')
    .maybeSingle();

  if (error) throw new Error(`Failed to get patient position: ${error.message}`);
  return data;
}

/**
 * Get clinic statistics.
 */
export async function getClinicStats(supabase, clinicId) {
  const { data: queue, error } = await supabase
    .from('queues')
    .select('status, entered_at, completed_at')
    .eq('clinic_id', clinicId);

  if (error) throw new Error(`Failed to get clinic stats: ${error.message}`);

  const stats = {
    total_patients: queue.length,
    waiting: queue.filter((p) => p.status === 'waiting').length,
    serving: queue.filter((p) => p.status === 'serving').length,
    completed: queue.filter((p) => p.status === 'completed').length,
  };

  const completedPatients = queue.filter((p) => p.status === 'completed' && p.completed_at);
  if (completedPatients.length > 0) {
    const totalWaitTime = completedPatients.reduce((sum, p) => {
      const wait = new Date(p.completed_at) - new Date(p.entered_at);
      return sum + wait;
    }, 0);
    stats.average_wait_time = Math.round(totalWaitTime / completedPatients.length / 1000 / 60);
  } else {
    stats.average_wait_time = 0;
  }

  return stats;
}

/**
 * Verify clinic PIN.
 */
export async function verifyClinicPin(supabase, clinicId, pin) {
  const { data, error } = await supabase
    .from('clinics')
    .select('pin')
    .eq('id', clinicId)
    .single();

  if (error) throw new Error(`Failed to verify PIN: ${error.message}`);
  return { valid: data.pin === pin };
}

/**
 * Create a notification.
 */
export async function createNotification(supabase, notificationData) {
  const { data, error } = await supabase
    .from('notifications')
    .insert(notificationData)
    .select()
    .single();

  if (error) throw new Error(`Failed to create notification: ${error.message}`);
  return data;
}

/**
 * Get settings.
 */
export async function getSettings(supabase, key = null) {
  let query = supabase.from('system_settings').select('*');
  if (key) query = query.eq('key', key).maybeSingle();
  const { data, error } = await query;
  if (error) throw new Error(`Failed to get settings: ${error.message}`);
  return data;
}

export default {
  getSupabaseClient,
  getActiveQueues,
  addToQueue,
  callNextPatient,
  completePatient,
  getPatientPosition,
  getClinicStats,
  verifyClinicPin,
  createNotification,
  getSettings,
};
