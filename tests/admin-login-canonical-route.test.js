import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const apiV1Source = fs.readFileSync('api/v1.js', 'utf8');

test('admin login route exists before delegated handler', () => {
  const delegatedIndex = apiV1Source.indexOf('return await delegatedV1Handler(req, res, { supabase, ADMIN_AUTH_SECRET });');
  const routeIndex = apiV1Source.indexOf("if (pathname === '/api/v1/admin/login' && method === 'POST')");
  assert.notEqual(delegatedIndex, -1);
  assert.notEqual(routeIndex, -1);
  assert.ok(routeIndex < delegatedIndex);
});
