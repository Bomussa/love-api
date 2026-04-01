/**
 * @fileoverview Supabase Client Wrapper - Doctor-Controlled Queue System
 * @description Provides Supabase client and database operations for the queue system.
 *              PIN-related functions removed; all operations use doctor-controlled flow.
 * @version 4.0.0
 * @since 2025-04-01
 */

import { createClient } from '@supabase/supabase-js';

/**
 * Creates a Supabase client instance
 * @param {Object} env - Environment variables
 * @returns {Object} Supabase client
 * @throws {Error} If required environment variables are missing
 */
export function getSupabaseClient(env = process.env) {
  const supabaseUrl = env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_KEY || env.SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    throw new Error('SUPABASE_URL and a valid key must be set in environment variables');
  }

  return createClient(supabaseUrl, supabaseKey, {
    auth: { autoRefreshToken: true, persistSession: false },
    db: { schema: 'public' },
  });
}

/**
 * Gets all active queues (waiting, called, in_progress)
 * @param {Object} supabase - Supabase client
 * @param {string} [clinicId] - Optional clinic filter
 * @returns {Promise<Array>} Active queue entries
 */
export async function getActiveQueues(supabase, clinicId = null) {
  let query = supabase
    .from('queue')
    .select('*')
    .in('status', ['WAITING', 'CALLED', 'IN_PROGRESS'])
    .order('display_number', { ascending: true });

  if (clinicId) {
    query = query.eq('current_clinic_id', clinicId);
  }

  const { data, error } = await query;
  if (error) throw new Error(`Failed to fetch queues: ${error.message}`);
  return data || [];
}

/**
 * Adds a patient to the queue with atomic number generation
 * @param {Object} supabase - Supabase client
 * @param {Object} patientData - Patient data
 * @returns {Promise<Object>} Created queue entry
 */
export async function addToQueue(supabase, patientData) {
  const { patient_id, clinic_id, exam_type, path = [], idempotency_key = null } = patientData;

  // Get next display_number atomically
  const { data: nextNum, error: rpcError } = await supabase.rpc('get_next_queue_number', {
    p_clinic_id: clinic_id
  });

  if (rpcError) {
    console.error('RPC error, falling back to direct query:', rpcError);
  }

  const nextNumber = nextNum || 1;

  const { data, error } = await supabase
    .from('queue')
    .insert({
      patient_id,
      current_clinic_id: clinic_id,
      exam_type,
      status: 'WAITING',
      current_step: 0,
      path: path.length > 0 ? path : [clinic_id],
      display_number: nextNumber,
      idempotency_key,
      created_at: new Date().toISOString()
    })
    .select()
    .single();

  if (error) throw new Error(`Failed to add to queue: ${error.message}`);
  return data;
}

/**
 * Calls the next waiting patient for a clinic
 * @param {Object} supabase - Supabase client
 * @param {string} clinicId - Clinic UUID
 * @param {string} [doctorId] - Doctor UUID
 * @returns {Promise<Object|null>} Called patient or null if none waiting
 */
export async function callNextPatient(supabase, clinicId, doctorId = null) {
  // First, mark any timed-out called patients as missed
  await supabase.rpc('mark_missed_patients');

  // Get next waiting patient
  const { data: nextPatient, error: fetchError } = await supabase
    .from('queue')
    .select('*')
    .eq('current_clinic_id', clinicId)
    .eq('status', 'WAITING')
    .order('display_number', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (fetchError || !nextPatient) return null;

  // Update to CALLED status
  const { data, error } = await supabase
    .from('queue')
    .update({
      status: 'CALLED',
      called_at: new Date().toISOString(),
      doctor_id: doctorId,
      version: nextPatient.version + 1
    })
    .eq('id', nextPatient.id)
    .eq('version', nextPatient.version)
    .select()
    .single();

  if (error) throw new Error(`Failed to call patient: ${error.message}`);
  return data;
}

/**
 * Starts patient examination (CALLED -> IN_PROGRESS)
 * @param {Object} supabase - Supabase client
 * @param {string} queueId - Queue entry UUID
 * @param {string} [doctorId] - Doctor UUID
 * @returns {Promise<Object>} Updated queue entry
 */
export async function startExamination(supabase, queueId, doctorId = null) {
  const { data: queueEntry, error: fetchError } = await supabase
    .from('queue')
    .select('*')
    .eq('id', queueId)
    .maybeSingle();

  if (fetchError || !queueEntry) {
    throw new Error('Queue entry not found');
  }

  if (queueEntry.status !== 'CALLED') {
    throw new Error(`Cannot start: patient is in ${queueEntry.status} state`);
  }

  const { data, error } = await supabase
    .from('queue')
    .update({
      status: 'IN_PROGRESS',
      activated_at: new Date().toISOString(),
      doctor_id: doctorId || queueEntry.doctor_id,
      version: queueEntry.version + 1
    })
    .eq('id', queueId)
    .eq('version', queueEntry.version)
    .select()
    .single();

  if (error) throw new Error(`Failed to start examination: ${error.message}`);
  return data;
}

/**
 * Advances patient to next clinic or completes (IN_PROGRESS -> next/DONE)
 * @param {Object} supabase - Supabase client
 * @param {string} queueId - Queue entry UUID
 * @param {string} [doctorId] - Doctor UUID
 * @returns {Promise<Object>} Updated queue entry with completion status
 */
export async function advancePatient(supabase, queueId, doctorId = null) {
  const { data: queueEntry, error: fetchError } = await supabase
    .from('queue')
    .select('*')
    .eq('id', queueId)
    .maybeSingle();

  if (fetchError || !queueEntry) {
    throw new Error('Queue entry not found');
  }

  if (queueEntry.status !== 'IN_PROGRESS') {
    throw new Error(`Cannot advance: patient is in ${queueEntry.status} state`);
  }

  const currentStep = queueEntry.current_step;
  const path = queueEntry.path || [];
  const isLastStep = currentStep >= path.length - 1;

  if (isLastStep) {
    // Complete the queue
    const { data, error } = await supabase
      .from('queue')
      .update({
        status: 'DONE',
        completed_at: new Date().toISOString(),
        version: queueEntry.version + 1
      })
      .eq('id', queueId)
      .eq('version', queueEntry.version)
      .select()
      .single();

    if (error) throw new Error(`Failed to complete patient: ${error.message}`);

    // Decrement clinic load
    await supabase.rpc('decrement_clinic_load', { p_clinic_id: queueEntry.current_clinic_id });

    return { ...data, completed: true };
  } else {
    // Move to next clinic
    const nextStep = currentStep + 1;
    const nextClinicId = path[nextStep];

    // Decrement old clinic load
    await supabase.rpc('decrement_clinic_load', { p_clinic_id: queueEntry.current_clinic_id });

    // Get new queue number
    const { data: nextNum } = await supabase.rpc('get_next_queue_number', { p_clinic_id: nextClinicId });
    const nextNumber = nextNum || 1;

    // Update queue
    const { data, error } = await supabase
      .from('queue')
      .update({
        current_clinic_id: nextClinicId,
        display_number: nextNumber,
        status: 'WAITING',
        current_step: nextStep,
        called_at: null,
        activated_at: null,
        doctor_id: null,
        version: queueEntry.version + 1
      })
      .eq('id', queueId)
      .eq('version', queueEntry.version)
      .select()
      .single();

    if (error) throw new Error(`Failed to advance patient: ${error.message}`);

    // Increment new clinic load
    await supabase.rpc('increment_clinic_load', { p_clinic_id: nextClinicId });

    return { ...data, completed: false };
  }
}

/**
 * Gets patient's current position in queue
 * @param {Object} supabase - Supabase client
 * @param {string} patientId - Patient ID
 * @returns {Promise<Object|null>} Position data or null
 */
export async function getPatientPosition(supabase, patientId) {
  const { data, error } = await supabase
    .from('queue')
    .select('display_number, status, current_clinic_id, current_step, path')
    .eq('patient_id', patientId)
    .in('status', ['WAITING', 'CALLED', 'IN_PROGRESS'])
    .maybeSingle();

  if (error) throw new Error(`Failed to get patient position: ${error.message}`);
  return data;
}

/**
 * Gets clinic statistics
 * @param {Object} supabase - Supabase client
 * @param {string} clinicId - Clinic UUID
 * @returns {Promise<Object>} Clinic statistics
 */
export async function getClinicStats(supabase, clinicId) {
  const { data: queues, error } = await supabase
    .from('queue')
    .select('status, created_at, completed_at, activated_at')
    .eq('current_clinic_id', clinicId);

  if (error) throw new Error(`Failed to get clinic stats: ${error.message}`);

  const stats = {
    total_patients: queues?.length || 0,
    waiting: queues?.filter((p) => p.status === 'WAITING').length || 0,
    called: queues?.filter((p) => p.status === 'CALLED').length || 0,
    in_progress: queues?.filter((p) => p.status === 'IN_PROGRESS').length || 0,
    completed: queues?.filter((p) => p.status === 'DONE').length || 0,
  };

  // Calculate average wait time
  const completedPatients = queues?.filter((p) => p.status === 'DONE' && p.completed_at) || [];
  if (completedPatients.length > 0) {
    const totalWaitTime = completedPatients.reduce((sum, p) => {
      const wait = new Date(p.completed_at) - new Date(p.created_at);
      return sum + wait;
    }, 0);
    stats.average_wait_time_minutes = Math.round(totalWaitTime / completedPatients.length / 1000 / 60);
  } else {
    stats.average_wait_time_minutes = 0;
  }

  return stats;
}

/**
 * Creates a notification
 * @param {Object} supabase - Supabase client
 * @param {Object} notificationData - Notification data
 * @returns {Promise<Object>} Created notification
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
 * Gets system settings
 * @param {Object} supabase - Supabase client
 * @param {string} [key] - Specific setting key
 * @returns {Promise<Object>} Settings data
 */
export async function getSettings(supabase, key = null) {
  let query = supabase.from('system_settings').select('*');
  if (key) query = query.eq('key', key).maybeSingle();
  const { data, error } = await query;
  if (error) throw new Error(`Failed to get settings: ${error.message}`);
  return data;
}

/**
 * Logs queue action to audit trail
 * @param {Object} supabase - Supabase client
 * @param {Object} logData - Log entry data
 */
export async function logQueueAction(supabase, logData) {
  const { queue_id, patient_id, action, doctor_id, clinic_id, from_step, to_step, details = {} } = logData;
  
  try {
    await supabase.from('queue_logs').insert({
      queue_id,
      patient_id,
      action,
      doctor_id,
      clinic_id,
      from_step,
      to_step,
      details,
      created_at: new Date().toISOString()
    });
  } catch (err) {
    console.error('Failed to log queue action:', err);
  }
}

// Default export
export default {
  getSupabaseClient,
  getActiveQueues,
  addToQueue,
  callNextPatient,
  startExamination,
  advancePatient,
  getPatientPosition,
  getClinicStats,
  createNotification,
  getSettings,
  logQueueAction,
};
