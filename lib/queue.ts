import { supabase, callRPC } from './supabase.ts';

export interface QueueItem {
  id: string;
  clinic_id: string;
  patient_id: string;
  position: number;
  status: 'WAITING' | 'YOUR_TURN' | 'DONE' | 'CANCELLED';
  exam_type?: string;
  entered_at: string;
  called_at?: string;
  completed_at?: string;
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
      .from('queue')
      .select('status')
      .eq('clinic_id', clinicId)
      .neq('status', 'DONE');
    
    if (error) throw error;

    const snapshot: QueueSnapshot = {
      total: data?.length || 0,
      waiting: data?.filter((q: any) => q.status === 'WAITING').length || 0,
      your_turn: data?.filter((q: any) => q.status === 'YOUR_TURN').length || 0,
      done: 0,
      cancelled: data?.filter((q: any) => q.status === 'CANCELLED').length || 0
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
      .from('queue')
      .insert({
        clinic_id: clinicId,
        patient_id: patientId,
        exam_type: examType,
        position: nextNumber,
        status: 'WAITING',
        entered_at: new Date().toISOString()
      })
      .select()
      .single();

    if (error) throw error;
    return data as QueueItem;
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
      .from('queue')
      .select('position, status')
      .eq('clinic_id', clinicId)
      .eq('patient_id', patientId)
      .neq('status', 'DONE')
      .order('entered_at', { ascending: true })
      .limit(1)
      .single();

    if (error && error.code !== 'PGRST116') throw error; // PGRST116 = no rows
    return data || null;
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
  status: 'WAITING' | 'YOUR_TURN' | 'DONE' | 'CANCELLED'
): Promise<QueueItem> {
  try {
    const { data, error } = await supabase
      .from('queue')
      .update({
        status,
        ...(status === 'YOUR_TURN' && { called_at: new Date().toISOString() }),
        ...(status === 'DONE' && { completed_at: new Date().toISOString() })
      })
      .eq('id', queueId)
      .select()
      .single();

    if (error) throw error;
    return data as QueueItem;
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
      .from('queue')
      .select('*')
      .eq('clinic_id', clinicId)
      .eq('status', 'WAITING')
      .order('entered_at', { ascending: true })
      .limit(limit);

    if (error) throw error;
    return data as QueueItem[];
  } catch (err) {
    console.error('Error getting top waiting patients:', err);
    throw err;
  }
}
