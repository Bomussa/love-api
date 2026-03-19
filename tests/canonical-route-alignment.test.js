import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const apiV1Source = fs.readFileSync('api/v1.js', 'utf8');
const legacyHandlersSource = fs.readFileSync('lib/api-handlers.js', 'utf8');
const vercelConfig = JSON.parse(fs.readFileSync('vercel.json', 'utf8'));

function extractIfBlock(source, routeSnippet) {
  const start = source.indexOf(routeSnippet);
  if (start === -1) return '';
  const remainder = source.slice(start);
  const nextIf = remainder.indexOf('\n    if (', routeSnippet.length);
  return nextIf === -1 ? remainder : remainder.slice(0, nextIf);
}

test('canonical routes are handled by api/v1.js before legacy delegation', () => {
  const delegatedCallIndex = apiV1Source.indexOf('return await delegatedV1Handler(req, res, { supabase, ADMIN_AUTH_SECRET });');
  assert.notEqual(delegatedCallIndex, -1, 'delegated handler call must exist');

  const canonicalRoutes = [
    "if ((pathname === '/api/v1/patient/login' || pathname === '/api/v1/patients/login') && method === 'POST')",
    "if (pathname === '/api/v1/queue/enter' && method === 'POST')",
    "if (pathname === '/api/v1/queue/status' && method === 'GET')",
    "if (pathname === '/api/v1/queue/call' && method === 'POST')",
    "if (pathname === '/api/v1/pin/verify' && method === 'POST')",
  ];

  for (const route of canonicalRoutes) {
    const routeIndex = apiV1Source.indexOf(route);
    assert.notEqual(routeIndex, -1, `missing canonical route block: ${route}`);
    assert.ok(routeIndex < delegatedCallIndex, `canonical route must run before delegated handler: ${route}`);
  }
});

test('canonical queue enter uses atomic RPC and has no client-side next-number fallback', () => {
  const queueEnterBlock = extractIfBlock(apiV1Source, "if (pathname === '/api/v1/queue/enter' && method === 'POST')");
  assert.match(queueEnterBlock, /enter_unified_queue_safe/);
  assert.match(queueEnterBlock, /ATOMIC_QUEUE_RPC_UNAVAILABLE/);
  assert.doesNotMatch(queueEnterBlock, /queue\.patients\.length\s*\+\s*1/);
  assert.doesNotMatch(queueEnterBlock, /from\('queues'\)\.insert/);
});

test('canonical queue call handler is DB-backed and avoids KV or shift logic', () => {
  const queueCallBlock = extractIfBlock(apiV1Source, "if (pathname === '/api/v1/queue/call' && method === 'POST')");
  assert.match(queueCallBlock, /from\('queues'\)/);
  assert.match(queueCallBlock, /update\(\{\s*status:\s*'called'/);
  assert.doesNotMatch(queueCallBlock, /KV_QUEUES/);
  assert.doesNotMatch(queueCallBlock, /patients\.shift\(\)/);
});

test('patient login and pin verify canonical paths align to DB-backed contracts', () => {
  const loginBlock = extractIfBlock(apiV1Source, "if ((pathname === '/api/v1/patient/login' || pathname === '/api/v1/patients/login') && method === 'POST')");
  assert.match(loginBlock, /normalizePatientIdentifier\(body\.personalId \|\| body\.patientId\)/);
  assert.match(loginBlock, /upsert\(\[\{ patient_id: patientId, gender, status: 'active' \}\]/);

  const pinVerifyBlock = extractIfBlock(apiV1Source, "if (pathname === '/api/v1/pin/verify' && method === 'POST')");
  assert.match(pinVerifyBlock, /findUsablePinRecord\(supabase, clinicId, pin\)/);
  assert.doesNotMatch(pinVerifyBlock, /KV_PINS/);
});

test('legacy overlapping endpoint implementations are removed from lib/api-handlers.js', () => {
  const removedLegacyRoutes = [
    "pathname === '/api/v1/patient/login'",
    "pathname === '/api/v1/queue/enter'",
    "pathname === '/api/v1/queue/status'",
    "pathname === '/api/v1/queue/call'",
    "pathname === '/api/v1/pin/verify'",
  ];

  for (const routeSnippet of removedLegacyRoutes) {
    assert.equal(
      legacyHandlersSource.includes(routeSnippet),
      false,
      `legacy route snippet should be removed from api-handlers.js: ${routeSnippet}`,
    );
  }
});

test('Vercel rewrites send /api/v1/* traffic to api/v1.js canonical entrypoint', () => {
  const rewrite = (vercelConfig.rewrites || []).find((item) => item.source === '/api/v1/(.*)');
  assert.ok(rewrite, 'expected /api/v1/(.*) rewrite entry in vercel.json');
  assert.equal(rewrite.destination, '/api/v1.js');
});
