// Simple verification script for PIN logic
const fs = require('fs');
const path = require('path');

// Read the shared service file
const content = fs.readFileSync(path.join(__dirname, '../supabase/functions/_shared/pin-service.js'), 'utf8');

// Convert ESM to CommonJS for testing in Node
const cjsContent = content
  .replace(/export const/g, 'const')
  .replace(/export function/g, 'function')
  + '\nmodule.exports = { generatePinCode, getServiceDayBoundaries, isWithinServiceHours };';

fs.writeFileSync(path.join(__dirname, 'temp-pin-service.js'), cjsContent);

const { generatePinCode, getServiceDayBoundaries, isWithinServiceHours } = require('./temp-pin-service.js');

console.log('--- PIN Logic Verification ---');

// 1. Range Test
let minPin = 100, maxPin = 0;
for(let i=0; i<10000; i++) {
    const p = parseInt(generatePinCode(2, 99));
    if(p < minPin) minPin = p;
    if(p > maxPin) maxPin = p;
}
console.log(`Range Test (10,000 runs): Min=${minPin}, Max=${maxPin}`);
if(minPin >= 2 && maxPin <= 99) {
    console.log('✅ Range Test Passed (2-99)');
} else {
    console.log('❌ Range Test Failed');
}

// 2. Service Boundaries Test
const { start, end } = getServiceDayBoundaries();
console.log(`Service Start: ${start.getHours()}:${start.getMinutes().toString().padStart(2, '0')}`);
console.log(`Service End: ${end.getHours()}:${end.getMinutes().toString().padStart(2, '0')}`);
if(start.getHours() === 5 && end.getHours() === 23) {
    console.log('✅ Service Boundaries Passed (05:00 - 23:59)');
} else {
    console.log('❌ Service Boundaries Failed');
}

// 3. Service Hours Logic
const originalDate = Date;
function setMockTime(hours) {
    global.Date = class extends originalDate {
        constructor() { return new originalDate(new originalDate().setHours(hours, 0, 0, 0)); }
    };
}

setMockTime(6);
const morningOk = isWithinServiceHours();
console.log(`Is 06:00 AM within service? ${morningOk}`);

setMockTime(1);
const nightOk = isWithinServiceHours();
console.log(`Is 01:00 AM within service? ${nightOk}`);

global.Date = originalDate;

if(morningOk === true && nightOk === false) {
    console.log('✅ Service Hours Logic Passed');
} else {
    console.log('❌ Service Hours Logic Failed');
}

// Cleanup
fs.unlinkSync(path.join(__dirname, 'temp-pin-service.js'));
