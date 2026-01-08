import { supabase } from './supabase.ts';

export async function getNextTicket(clinicId: string) {
  const { data, error } = await supabase.rpc('fn_get_next_ticket', { p_clinic: clinicId });
  if (error) throw error;
  return data;
}

export async function getQueueSnapshot(clinicId: string) {
  const { data, error } = await supabase
    .from('queue')
    .select('*')
    .eq('clinic_id', clinicId)
    .neq('status', 'completed')
    .order('entered_at', { ascending: true })
    .limit(100);
  
  if (error) throw error;
  return data;
}

export async function createTicket(clinicId: string, patientId: string, examType?: string) {
  const nextNumber = await getNextTicket(clinicId);
  
  const { data, error } = await supabase
    .from('queue')
    .insert({
      clinic_id: clinicId,
      patient_id: patientId,
      exam_type: examType,
      position: nextNumber,
      status: 'waiting'
    })
    .select()
    .single();
    
  if (error) throw error;
  return data;
}
