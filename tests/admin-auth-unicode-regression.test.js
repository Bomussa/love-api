import test from 'node:test';
import assert from 'node:assert/strict';
import { createAdminToken, verifyAdminBearerToken } from '../lib/admin-auth.js';

const secret = 's'.repeat(32);

test('admin JWT supports UTF-8 usernames (Arabic) without breaking verification', () => {
  const now = Date.UTC(2026, 2, 17, 0, 0, 0);
  const token = createAdminToken({
    id: 'admin-ar-1',
    username: 'بوموسى',
    role: 'SUPER_ADMIN',
  }, secret, now);

  assert.equal(verifyAdminBearerToken(`Bearer ${token}`, secret, now + 1_000), true);

  const [, payloadPart] = token.split('.');
  const payloadJson = Buffer.from(payloadPart, 'base64url').toString('utf8');
  const payload = JSON.parse(payloadJson);

  assert.equal(payload.username, 'بوموسى');
  assert.equal(payload.role, 'SUPER_ADMIN');
});
