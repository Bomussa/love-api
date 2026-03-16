import test from 'node:test';
import assert from 'node:assert/strict';

function createMockReq({ method = 'GET', url = '/api/v1/health', origin } = {}) {
  return {
    method,
    url,
    headers: {
      host: 'mmc-mms.com',
      ...(origin ? { origin } : {}),
    },
    body: undefined,
  };
}

function createMockRes() {
  const headers = new Map();
  return {
    statusCode: 200,
    payload: undefined,
    ended: false,
    setHeader(key, value) {
      headers.set(key.toLowerCase(), value);
    },
    getHeader(key) {
      return headers.get(String(key).toLowerCase());
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.payload = body;
      this.ended = true;
      return this;
    },
    end() {
      this.ended = true;
      return this;
    },
  };
}

async function loadV1Handler() {
  process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://example.supabase.co';
  process.env.SUPABASE_KEY = process.env.SUPABASE_KEY || 'anon-key';
  process.env.SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'anon-key';
  const mod = await import(`../api/v1.js?t=${Date.now()}`);
  return mod.default;
}

test('CORS contract: trusted origin (https://mmc-mms.com) is echoed with credentials enabled', async () => {
  const handler = await loadV1Handler();
  const req = createMockReq({ origin: 'https://mmc-mms.com' });
  const res = createMockRes();

  await handler(req, res);

  assert.equal(res.getHeader('access-control-allow-origin'), 'https://mmc-mms.com');
  assert.equal(res.getHeader('access-control-allow-credentials'), 'true');
  assert.notEqual(res.statusCode, 403);
});

test('CORS contract: untrusted origin is blocked and never downgraded to wildcard', async () => {
  const handler = await loadV1Handler();
  const req = createMockReq({ origin: 'https://evil.example' });
  const res = createMockRes();

  await handler(req, res);

  assert.equal(res.statusCode, 403);
  assert.equal(res.getHeader('access-control-allow-origin'), undefined);
  assert.equal(res.getHeader('access-control-allow-credentials'), 'true');
  assert.equal(res.payload?.error, 'Origin is not allowed by CORS policy.');
});
