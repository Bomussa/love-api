import test from 'node:test';
import assert from 'node:assert/strict';
import { QUEUE_CANONICAL_OPERATIONS, queueCanonicalPath } from '../lib/queue-canonical-contract.js';

test('queue canonical operations keep stable paths and function names', () => {
  assert.equal(queueCanonicalPath('/api/v1', QUEUE_CANONICAL_OPERATIONS.enter), '/api/v1/queue/enter');
  assert.equal(QUEUE_CANONICAL_OPERATIONS.enter.functionName, 'queue-enter');
  assert.equal(queueCanonicalPath('/api/v1', QUEUE_CANONICAL_OPERATIONS.status), '/api/v1/queue/status');
  assert.equal(QUEUE_CANONICAL_OPERATIONS.status.functionName, 'queue-status');
  assert.equal(queueCanonicalPath('/api/v1', QUEUE_CANONICAL_OPERATIONS.call), '/api/v1/queue/call');
  assert.equal(QUEUE_CANONICAL_OPERATIONS.call.functionName, 'call-next-patient');
});

test('pin verify canonical mapping preserves contract identifiers', () => {
  assert.equal(queueCanonicalPath('/api/v1', QUEUE_CANONICAL_OPERATIONS.pinVerify), '/api/v1/pin/verify');
  assert.equal(QUEUE_CANONICAL_OPERATIONS.pinVerify.functionName, 'call-next-patient');
});
