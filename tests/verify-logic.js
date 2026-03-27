// ESM verification script for PIN logic
import { 
  generatePinCode, 
  getServiceDayBoundaries, 
  isWithinServiceHours 
} from '../supabase/functions/_shared/pin-service.js';

console.log('--- PIN Logic Verification (ESM) ---');

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
// Note: Mocking Date in ESM is tricky, so we'll test manually with boundary checks
const now = new Date();
const { start: s, end: e } = getServiceDayBoundaries();
const isOk = isWithinServiceHours();
console.log(`Current Time: ${now.getHours()}:${now.getMinutes()}`);
console.log(`Is current time within service? ${isOk}`);
console.log(`Logic: (now >= ${s.getHours()}:00 && now <= ${e.getHours()}:59)`);

if ((now.getHours() >= 5 && now.getHours() <= 23) === isOk) {
    console.log('✅ Service Hours Logic Consistent');
} else {
    console.log('❌ Service Hours Logic Inconsistent');
}
