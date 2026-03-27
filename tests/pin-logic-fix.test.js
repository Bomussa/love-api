const { 
  generatePinCode, 
  getServiceDayBoundaries, 
  isWithinServiceHours 
} = require('../supabase/functions/_shared/pin-service.js');

describe('PIN Logic Fix Verification', () => {
  test('generatePinCode should be between 2 and 99', () => {
    for (let i = 0; i < 1000; i++) {
      const pin = parseInt(generatePinCode(2, 99));
      expect(pin).toBeGreaterThanOrEqual(2);
      expect(pin).toBeLessThanOrEqual(99);
    }
  });

  test('Service hours should be 05:00 to 23:59:59', () => {
    const { start, end } = getServiceDayBoundaries();
    expect(start.getHours()).toBe(5);
    expect(start.getMinutes()).toBe(0);
    expect(end.getHours()).toBe(23);
    expect(end.getMinutes()).toBe(59);
  });

  test('isWithinServiceHours should work correctly', () => {
    // Mock Date
    const originalDate = Date;
    
    // Test 06:00 AM (Inside)
    global.Date = class extends originalDate {
      constructor() { return new originalDate(new originalDate().setHours(6, 0, 0, 0)); }
    };
    expect(isWithinServiceHours()).toBe(true);

    // Test 01:00 AM (Outside)
    global.Date = class extends originalDate {
      constructor() { return new originalDate(new originalDate().setHours(1, 0, 0, 0)); }
    };
    expect(isWithinServiceHours()).toBe(false);

    // Restore Date
    global.Date = originalDate;
  });
});
