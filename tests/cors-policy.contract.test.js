import test from 'node:test';
import assert from 'node:assert/strict';
import { isAllowedOrigin, resolveCorsHeaders } from '../lib/cors-policy.js';

test('allows production and staging origins', () => {
  assert.equal(isAllowedOrigin('https://mmc-mms.com'), true);
  assert.equal(isAllowedOrigin('https://www.mmc-mms.com'), true);
  assert.equal(isAllowedOrigin('https://staging.mmc-mms.com'), true);
});

test('denies unknown origins', () => {
  assert.equal(isAllowedOrigin('https://evil.example.com'), false);
  assert.equal(isAllowedOrigin('null'), false);
});

test('status category preflight exposes minimal methods and headers', () => {
  const headers = resolveCorsHeaders({ origin: 'https://mmc-mms.com', category: 'status' });
  assert.equal(headers['Access-Control-Allow-Origin'], 'https://mmc-mms.com');
  assert.equal(headers['Access-Control-Allow-Methods'], 'GET, OPTIONS');
  assert.equal(headers['Access-Control-Allow-Headers'], 'Content-Type, Authorization, apikey, x-client-info');
});

test('write category preflight uses write methods and omits allow-origin when denied', () => {
  const headers = resolveCorsHeaders({ origin: 'https://evil.example.com', category: 'write' });
  assert.equal(headers['Access-Control-Allow-Origin'], undefined);
  assert.equal(headers['Access-Control-Allow-Methods'], 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
});
