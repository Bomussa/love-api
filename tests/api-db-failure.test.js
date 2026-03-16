import test from 'node:test';
import assert from 'node:assert/strict';

function createRes() {
  return {
    statusCode: 200,
    headers: {},
    body: null,
    setHeader(key, value) {
      this.headers[key] = value;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
    end() {
      return this;
    },
  };
}

test('GET /api/v1/queue/status returns explicit DB error on storage outage', async (t) => {
  const oldUrl = process.env.SUPABASE_URL;
  const oldKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://example.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-service-role-key';

  t.after(() => {
    process.env.SUPABASE_URL = oldUrl;
    process.env.SUPABASE_SERVICE_ROLE_KEY = oldKey;
  });

  const { default: handler, __setStoresForTest } = await import('../lib/api-handlers.js');

  __setStoresForTest({
    supabase: {},
    KV_ADMIN: { get: async () => null, put: async () => true },
    KV_PINS: { get: async () => null, put: async () => true },
    KV_QUEUES: {
      get: async () => {
        const error = new Error('Simulated DB outage');
        error.code = 'DB_KV_GET_FAILED';
        error.statusCode = 503;
        throw error;
      },
      put: async () => true,
    },
    KV_EVENTS: { put: async () => true },
    KV_LOCKS: {},
    KV_CACHE: {},
  });

  t.after(() => __setStoresForTest(null));

  const req = {
    method: 'GET',
    url: '/api/v1/queue/status?clinicId=lab',
    headers: { host: 'mmc-mms.com' },
    connection: { remoteAddress: '127.0.0.1' },
    socket: { remoteAddress: '127.0.0.1' },
  };
  const res = createRes();

  await handler(req, res);

  assert.equal(res.statusCode, 503);
  assert.equal(res.body?.success, false);
  assert.equal(res.body?.code, 'DB_KV_GET_FAILED');
  assert.equal(res.body?.error, 'Database operation failed');
});
