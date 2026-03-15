import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveHealthState, evaluateSystemStatus } from '../api/maintenance.js';

test('resolveHealthState supports direct healthy payload', () => {
  assert.equal(resolveHealthState({ status: 'healthy' }), 'healthy');
  assert.equal(resolveHealthState({ status: 'ok' }), 'healthy');
  assert.equal(resolveHealthState({ status: 'operational' }), 'healthy');
});

test('resolveHealthState supports wrapped payload', () => {
  assert.equal(resolveHealthState({ success: true, data: { status: 'healthy' } }), 'healthy');
  assert.equal(resolveHealthState({ success: true, data: { status: 'degraded' } }), 'degraded');
});

test('resolveHealthState maps unknown payloads safely', () => {
  assert.equal(resolveHealthState(null), 'unknown');
  assert.equal(resolveHealthState({}), 'unknown');
  assert.equal(resolveHealthState({ status: 'broken' }), 'down');
});

test('evaluateSystemStatus returns down when host header is missing', async () => {
  const req = { headers: {} };
  const state = await evaluateSystemStatus(req);
  assert.equal(state, 'down');
});

test('evaluateSystemStatus returns healthy when upstream returns wrapped healthy', async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => ({
    ok: true,
    json: async () => ({ success: true, data: { status: 'healthy' } }),
  });

  try {
    const req = { headers: { host: 'mmc-mms.com' } };
    const state = await evaluateSystemStatus(req);
    assert.equal(state, 'healthy');
  } finally {
    global.fetch = originalFetch;
  }
});

test('evaluateSystemStatus returns degraded on degraded upstream status', async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => ({
    ok: true,
    json: async () => ({ status: 'degraded' }),
  });

  try {
    const req = { headers: { host: 'mmc-mms.com' } };
    const state = await evaluateSystemStatus(req);
    assert.equal(state, 'degraded');
  } finally {
    global.fetch = originalFetch;
  }
});

test('evaluateSystemStatus returns down on non-OK upstream', async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => ({
    ok: false,
    json: async () => ({ status: 'healthy' }),
  });

  try {
    const req = { headers: { host: 'mmc-mms.com' } };
    const state = await evaluateSystemStatus(req);
    assert.equal(state, 'down');
  } finally {
    global.fetch = originalFetch;
  }
});
