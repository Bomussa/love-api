import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { validateTransition, _testOnly_getRoutePath, _testOnly_rateLimit } from '../api/v1.js';

const migrationPath = new URL('../supabase/migrations/20260402120000_system_closure.sql', import.meta.url);
const apiPath = new URL('../api/v1.js', import.meta.url);

test('route path chooses female path and fallback exam type', () => {
  const path = _testOnly_getRoutePath('unknown', 'female');
  assert.equal(path[0], 'LAB');
  assert.ok(path.length > 1);
});

test('state machine blocks backward and invalid done transitions', async () => {
  await assert.rejects(() => validateTransition({ status: 'DONE', path: ['A'], current_step: 1 }, 'WAITING', 1));
  await assert.rejects(() => validateTransition({ status: 'IN_PROGRESS', path: ['A','B'], current_step: 1 }, 'DONE', 1));
});

test('state machine allows linear flow', async () => {
  await validateTransition({ status: 'WAITING', path: ['A','B'], current_step: 0 }, 'IN_PROGRESS', 0);
  await validateTransition({ status: 'IN_PROGRESS', path: ['A','B'], current_step: 1 }, 'DONE', 2);
});

test('rate limiter enforces thresholds', () => {
  const key = `doctor-${Date.now()}`;
  assert.equal(_testOnly_rateLimit('advanceByDoctor', key, 2, 10000), true);
  assert.equal(_testOnly_rateLimit('advanceByDoctor', key, 2, 10000), true);
  assert.equal(_testOnly_rateLimit('advanceByDoctor', key, 2, 10000), false);
});

test('migration is standalone and contains required base schema', () => {
  const migration = fs.readFileSync(migrationPath, 'utf8');
  assert.match(migration, /CREATE TABLE IF NOT EXISTS clinics/i);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS queues/i);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS idempotency_keys/i);
  assert.match(migration, /id UUID PRIMARY KEY DEFAULT gen_random_uuid\(\)/i);
  assert.match(migration, /path JSONB NOT NULL/i);
});

test('migration enforces constraints and duplicate-safe atomic creation with retry', () => {
  const migration = fs.readFileSync(migrationPath, 'utf8');
  assert.match(migration, /unique_queue_per_clinic[\s\S]*UNIQUE \(clinic_id, queue_number\)/i);
  assert.match(migration, /status_check[\s\S]*WAITING','IN_PROGRESS','DONE','CANCELLED/i);
  assert.match(migration, /step_bounds[\s\S]*current_step >= 0/i);
  assert.match(migration, /FOR UPDATE/i);
  assert.match(migration, /WHEN unique_violation THEN/i);
});

test('api idempotency returns stored response directly and stores full payload', () => {
  const api = fs.readFileSync(apiPath, 'utf8');
  assert.match(api, /select\('response'\)\.eq\('key', idempotencyKey\)\.maybeSingle\(\)/);
  assert.match(api, /if \(idRow\?\.response\) return reply\(200, idRow\.response\);/);
  assert.match(api, /from\('idempotency_keys'\)\.insert\(\{/);
  assert.doesNotMatch(api, /_idempotent/);
});
