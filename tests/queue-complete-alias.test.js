import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const legacyHandlersSource = fs.readFileSync('lib/api-handlers.js', 'utf8');

function extractIfBlock(source, routeSnippet) {
  const start = source.indexOf(routeSnippet);
  if (start === -1) return '';
  const remainder = source.slice(start);
  const nextIf = remainder.indexOf('\n    if (', routeSnippet.length);
  return nextIf === -1 ? remainder : remainder.slice(0, nextIf);
}

test('queue complete alias maps to canonical queue done logic', () => {
  const routeSnippet = "if ((pathname === '/api/v1/queue/done' || pathname === '/api/v1/queue/complete') && method === 'POST')";
  const queueDoneBlock = extractIfBlock(legacyHandlersSource, routeSnippet);

  assert.notEqual(queueDoneBlock, '', 'queue complete/done route block must exist');
  assert.match(queueDoneBlock, /const clinicId = String\(body\.clinicId \|\| body\.clinic_id \|\| ''\)\.trim\(\);/);
  assert.match(queueDoneBlock, /const patientId = String\(body\.patientId \|\| body\.visitId \|\| ''\)\.trim\(\);/);
  assert.match(queueDoneBlock, /const pin = String\(body\.pin \|\| body\.ticket \|\| ''\)\.trim\(\);/);
  assert.match(queueDoneBlock, /Missing required fields: clinicId\|clinic_id, patientId\|visitId, pin\|ticket/);
});
