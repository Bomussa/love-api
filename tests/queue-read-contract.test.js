import test from 'node:test';
import assert from 'node:assert/strict';

import { summarizeQueueRows } from '../supabase/functions/_shared/queue-state.js';
import { buildQueueStatusPayload } from '../supabase/functions/queue-status/read-model.js';
import { buildQueueEngineStatus } from '../supabase/functions/queue-engine/read-model.js';

test('queue read endpoints expose matching counts from the same source rows', () => {
  const sourceRows = [
    { id: '1', status: 'waiting', display_number: 1, entered_at: '2026-03-16T08:00:00Z' },
    { id: '2', status: 'waiting', display_number: 2, entered_at: '2026-03-16T08:01:00Z' },
    { id: '3', status: 'called', display_number: 3, entered_at: '2026-03-16T08:02:00Z' },
    { id: '4', status: 'in_service', display_number: 4, entered_at: '2026-03-16T08:03:00Z' },
    { id: '5', status: 'completed', display_number: 5, entered_at: '2026-03-16T08:04:00Z' },
  ];

  const canonicalCounts = summarizeQueueRows(sourceRows);

  const queueStatusPayload = buildQueueStatusPayload('clinic-1', sourceRows);
  const queueEnginePayload = buildQueueEngineStatus('clinic-1', sourceRows);

  assert.deepEqual(queueStatusPayload.counts, canonicalCounts);
  assert.equal(queueStatusPayload.queueLength, canonicalCounts.waiting);

  assert.equal(queueEnginePayload.waiting_count, canonicalCounts.waiting);
  assert.equal(queueEnginePayload.called_count, canonicalCounts.called);
  assert.equal(queueEnginePayload.in_service_count, canonicalCounts.in_service);
  assert.equal(queueEnginePayload.completed_count, canonicalCounts.completed);
});
