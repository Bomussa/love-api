import test from 'node:test';
import assert from 'node:assert/strict';

import {
  generatePinCode,
  getServiceDayBoundaries,
  isWithinServiceHours,
} from '../supabase/functions/_shared/pin-service.js';

test('generatePinCode should be between 2 and 99', () => {
  for (let i = 0; i < 1000; i += 1) {
    const pin = Number.parseInt(generatePinCode(2, 99), 10);
    assert.ok(pin >= 2);
    assert.ok(pin <= 99);
  }
});

test('service day boundaries use 05:00 to 23:59 local service time', () => {
  process.env.PIN_SERVICE_UTC_OFFSET_MINUTES = '0';
  const { start, end } = getServiceDayBoundaries();
  assert.equal(start.getHours(), 5);
  assert.equal(start.getMinutes(), 0);
  assert.equal(end.getHours(), 23);
  assert.equal(end.getMinutes(), 59);
});

test('isWithinServiceHours respects configured UTC offset', () => {
  const originalDate = Date;

  process.env.PIN_SERVICE_UTC_OFFSET_MINUTES = '0';
  global.Date = class extends originalDate {
    constructor(...args) {
      return args.length ? new originalDate(...args) : new originalDate('2026-03-28T06:00:00.000Z');
    }
    static now() { return new originalDate('2026-03-28T06:00:00.000Z').getTime(); }
  };
  assert.equal(isWithinServiceHours(), true);

  global.Date = class extends originalDate {
    constructor(...args) {
      return args.length ? new originalDate(...args) : new originalDate('2026-03-28T01:00:00.000Z');
    }
    static now() { return new originalDate('2026-03-28T01:00:00.000Z').getTime(); }
  };
  assert.equal(isWithinServiceHours(), false);

  global.Date = originalDate;
});
