import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('supabase shared cors uses same production/staging allowlist patterns', () => {
  const content = fs.readFileSync('supabase/functions/_shared/cors.ts', 'utf8');
  assert.match(content, /mmc-mms\\\.com/);
  assert.match(content, /staging\\\.mmc-mms\\\.com/);
  assert.match(content, /localhost/);
});

test('supabase shared cors includes route-category methods/headers', () => {
  const content = fs.readFileSync('supabase/functions/_shared/cors.ts', 'utf8');
  assert.match(content, /status:[\s\S]*methods: 'GET, OPTIONS'/);
  assert.match(content, /write:[\s\S]*methods: 'GET, POST, PUT, PATCH, DELETE, OPTIONS'/);
});
