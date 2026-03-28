import test from 'node:test';
import assert from 'node:assert/strict';

import * as helpersEnhanced from '../lib/helpers-enhanced.js';

test('helpers-enhanced exports required symbols used by API entrypoints', () => {
  const required = [
    'setCorsHeaders',
    'parseBody',
    'getClientIP',
    'checkRateLimit',
    'validateClinicId',
    'formatError',
    'formatSuccess',
    'logRequest',
    'handleError',
  ];

  for (const name of required) {
    assert.equal(typeof helpersEnhanced[name], 'function', `missing helper export: ${name}`);
  }
});

test('api/v1 entrypoint can be imported without module instantiation errors', async () => {
  const module = await import('../api/v1.js');
  assert.equal(typeof module.default, 'function');
});
