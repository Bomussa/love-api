import { supabase, callRPC } from './supabase.ts';

export interface QueueItem {
  id: string;
  clinic_id: string;
  patient_id: string;
  position: number;
  status: 'waiting' | 'called' | 'completed' | 'cancelled';
  exam_type?: string;
  entered_at: string;
  called_at?: string;
  completed_at?: string;
}

interface QueueRow {
  id: string;
  clinic_id: string;
  patient_id: string;
  queue_number_int?: number | null;
  display_number?: number | null;
  status: QueueItem['status'];
  exam_type?: string | null;
  entered_at: string;
  called_at?: string | null;
  completed_at?: string | null;
}

function toQueueItem(row: QueueRow): QueueItem {
  return {
    id: row.id,
    clinic_id: row.clinic_id,
    patient_id: row.patient_id,
    position: row.queue_number_int ?? row.display_number ?? 0,
    status: row.status,
    exam_type: row.exam_type ?? undefined,
    entered_at: row.entered_at,
    called_at: row.called_at ?? undefined,
    completed_at: row.completed_at ?? undefined,
  };
}

export interface QueueSnapshot {
  total: number;
  waiting: number;
  your_turn: number;
  done: number;
  cancelled: number;
  next_position?: number;
}

/**
 * Get next ticket number using database function
 */
export async function getNextTicket(clinicId: string): Promise<number> {
  try {
    const result = await callRPC('fn_get_next_ticket', { p_clinic: clinicId });
    if (!result.success) throw new Error(result.error);
    return result.data;
  } catch (err) {
    console.error('Error getting next ticket:', err);
    throw err;
  }
}

/**
 * Get current queue snapshot for a clinic
 */
export async function getQueueSnapshot(clinicId: string): Promise<QueueSnapshot> {
  try {
    const { data, error } = await supabase
      .from('queues')
      .select('status')
      .eq('clinic_id', clinicId)
      .neq('status', 'completed');
    
    if (error) throw error;

    const snapshot: QueueSnapshot = {
      total: data?.length || 0,
      waiting: data?.filter((q: any) => q.status === 'waiting').length || 0,
      your_turn: data?.filter((q: any) => q.status === 'called').length || 0,
      done: 0,
      cancelled: data?.filter((q: any) => q.status === 'cancelled').length || 0
    };

    return snapshot;
  } catch (err) {
    console.error('Error getting queue snapshot:', err);
    throw err;
  }
}

/**
 * Create new ticket in queue
 */
export async function createTicket(
  clinicId: string,
  patientId: string,
  examType?: string
): Promise<QueueItem> {
  try {
    // Get next ticket number
    const nextNumber = await getNextTicket(clinicId);

    // Insert into queue
    const { data, error } = await supabase
      .from('queues')
      .insert({
        clinic_id: clinicId,
        patient_id: patientId,
        exam_type: examType,
        queue_number_int: nextNumber,
        display_number: nextNumber,
        queue_number: String(nextNumber),
        status: 'waiting',
        entered_at: new Date().toISOString()
      })
      .select('id, clinic_id, patient_id, queue_number_int, display_number, status, exam_type, entered_at, called_at, completed_at')
      .single();

    if (error) throw error;
    return toQueueItem(data as QueueRow);
  } catch (err) {
    console.error('Error creating ticket:', err);
    throw err;
  }
}

/**
 * Get patient's current queue position
 */
export async function getPatientQueuePosition(
  clinicId: string,
  patientId: string
): Promise<{ position: number; status: string } | null> {
  try {
    const { data, error } = await supabase
      .from('queues')
      .select('queue_number_int, status, display_number')
      .eq('clinic_id', clinicId)
      .eq('patient_id', patientId)
      .neq('status', 'completed')
      .order('entered_at', { ascending: true })
      .limit(1)
      .single();

    if (error && error.code !== 'PGRST116') throw error; // PGRST116 = no rows
    if (!data) return null;
    return { position: data.queue_number_int ?? data.display_number ?? 0, status: data.status };
  } catch (err) {
    console.error('Error getting patient queue position:', err);
    throw err;
  }
}

/**
 * Update queue item status
 */
export async function updateQueueStatus(
  queueId: string,
  status: 'waiting' | 'called' | 'completed' | 'cancelled'
): Promise<QueueItem> {
  try {
    const { data, error } = await supabase
      .from('queues')
      .update({
        status,
        ...(status === 'called' && { called_at: new Date().toISOString() }),
        ...(status === 'completed' && { completed_at: new Date().toISOString() })
      })
      .eq('id', queueId)
      .select('id, clinic_id, patient_id, queue_number_int, display_number, status, exam_type, entered_at, called_at, completed_at')
      .single();

    if (error) throw error;
    return toQueueItem(data as QueueRow);
  } catch (err) {
    console.error('Error updating queue status:', err);
    throw err;
  }
}

/**
 * Get top N waiting patients
 */
export async function getTopWaitingPatients(clinicId: string, limit: number = 10): Promise<QueueItem[]> {
  try {
    const { data, error } = await supabase
      .from('queues')
      .select('id, clinic_id, patient_id, queue_number_int, display_number, status, exam_type, entered_at, called_at, completed_at')
      .eq('clinic_id', clinicId)
      .eq('status', 'waiting')
      .order('entered_at', { ascending: true })
      .limit(limit);

    if (error) throw error;
    return (data || []).map((row) => toQueueItem(row as QueueRow));
  } catch (err) {
    console.error('Error getting top waiting patients:', err);
    throw err;
  }
}
