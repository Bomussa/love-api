import { summarizeQueueRows } from '../_shared/queue-state.js';

export function buildQueueEngineStatus(clinicId, queueData = []) {
  const counts = summarizeQueueRows(queueData);
  const currentInService = queueData.find((q) => q.status === 'in_service');

  return {
    status: 'OK',
    clinic_id: clinicId,
    waiting_count: counts.waiting,
    called_count: counts.called,
    in_service_count: counts.in_service,
    completed_count: counts.completed,
    serving_count: counts.in_service,
    current_number: currentInService?.display_number || null,
    last_number: queueData?.[queueData.length - 1]?.display_number || 0,
    queue: queueData,
  };
}
