import { assertQueueState, summarizeQueueRows } from '../_shared/queue-state.js';

export function buildQueueStatusPayload(clinicId, queueList = []) {
  const normalized = queueList.map((row) => ({
    id: row.id,
    status: assertQueueState(row.status, 'queue-status row.status'),
    entered_at: row.entered_at,
    called_at: row.called_at,
    completed_at: row.completed_at,
    patient_id: row.patient_id,
    position: row.queue_number_int ?? row.queue_position ?? row.display_number ?? null,
  }));

  const counts = summarizeQueueRows(normalized);
  const serving = normalized.find((q) => q.status === 'in_service')
    ?? normalized.find((q) => q.status === 'called');
  const waiting = normalized.filter((q) => q.status === 'waiting');

  return {
    clinic_id: clinicId,
    queueLength: counts.waiting,
    totalInQueue: normalized.length,
    currentServing: serving?.position ?? null,
    counts,
    next3: waiting.slice(0, 3).map((q) => ({
      position: q.position,
      waiting_since: q.entered_at,
    })),
  };
}
