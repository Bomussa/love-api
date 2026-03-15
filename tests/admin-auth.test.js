import test from 'node:test';
import assert from 'node:assert/strict';
import { createAdminToken, verifyAdminBearerToken, hasValidAdminSecret } from '../lib/admin-auth.js';

const secret = 'x'.repeat(32);

test('hasValidAdminSecret enforces minimum length', () => {
  assert.equal(hasValidAdminSecret(undefined), false);
  assert.equal(hasValidAdminSecret('short-secret'), false);
  assert.equal(hasValidAdminSecret(secret), true);
});

test('createAdminToken creates verifiable bearer token', () => {
  const now = Date.UTC(2026, 0, 1, 0, 0, 0);
  const token = createAdminToken({ id: 'admin-1', username: 'root', role: 'admin' }, secret, now);
  const isValid = verifyAdminBearerToken(`Bearer ${token}`, secret, now + 10_000);
  assert.equal(isValid, true);
});

test('verifyAdminBearerToken rejects expired tokens', () => {
  const now = Date.UTC(2026, 0, 1, 0, 0, 0);
  const token = createAdminToken({ id: 'admin-1', username: 'root', role: 'admin' }, secret, now);
  const afterExpiry = now + (24 * 60 * 60 * 1000) + 1;
  const isValid = verifyAdminBearerToken(`Bearer ${token}`, secret, afterExpiry);
  assert.equal(isValid, false);
});

test('verifyAdminBearerToken rejects mismatched secret', () => {
  const now = Date.UTC(2026, 0, 1, 0, 0, 0);
  const token = createAdminToken({ id: 'admin-1', username: 'root', role: 'admin' }, secret, now);
  const isValid = verifyAdminBearerToken(`Bearer ${token}`, 'y'.repeat(32), now + 1_000);
  assert.equal(isValid, false);
});
