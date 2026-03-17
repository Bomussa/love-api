import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

const BASE = 'https://mmc-mms.com';
const WWW = 'https://www.mmc-mms.com';

function sha256(content) {
  return createHash('sha256').update(content).digest('hex');
}

function fetchWithCurl(url, method = 'GET', body = '') {
  const args = ['-sS', '-L', '-w', '\n%{http_code}', url];
  if (method === 'POST') {
    args.unshift('-X', 'POST', '-H', 'content-type: application/json', '-d', body);
  }
  const output = execFileSync('curl', args, { encoding: 'utf8' });
  const idx = output.lastIndexOf('\n');
  return {
    text: output.slice(0, idx),
    status: Number(output.slice(idx + 1).trim()),
  };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function validateStatus(path, status) {
  if (path === '/api/health' || path === '/api/v1/status') {
    assert(status === 200, `${path} expected 200, got ${status}`);
  } else {
    assert(status === 200 || status === 401, `${path} expected 200 or 401, got ${status}`);
  }
}

function checkEndpoint(path, method = 'GET', body = '') {
  const { status } = fetchWithCurl(`${BASE}${path}`, method, body);
  validateStatus(path, status);
  console.log(`[PASS] ${method} ${path} -> HTTP ${status}`);
}

function main() {
  console.log('[INFO] Fetching homepage from both hosts...');
  const mainPage = fetchWithCurl(BASE);
  const wwwPage = fetchWithCurl(WWW);

  assert(mainPage.status === 200, `Unable to fetch ${BASE}, status=${mainPage.status}`);
  assert(wwwPage.status === 200, `Unable to fetch ${WWW}, status=${wwwPage.status}`);

  const mainHash = sha256(mainPage.text);
  const wwwHash = sha256(wwwPage.text);
  assert(mainHash === wwwHash, 'Host mismatch: mmc-mms.com and www.mmc-mms.com return different HTML payloads');

  console.log(`[PASS] Host payload parity verified (${mainHash})`);
  checkEndpoint('/api/health');
  checkEndpoint('/api/v1/status');
  checkEndpoint('/api/v1/health');
  checkEndpoint('/api/v1/queue/status?clinic_id=demo');
  checkEndpoint('/api/v1/pin/verify', 'POST', JSON.stringify({ pin: '0000', clinic_id: 'demo' }));
  console.log('[PASS] smoke-mmc-domains completed successfully');
}

try {
  main();
} catch (error) {
  console.error(`[FAIL] ${error.message}`);
  process.exit(1);
}
