import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const vercelConfig = JSON.parse(fs.readFileSync('vercel.json', 'utf8'));

test('backend dependency install/runtime contract is deterministic for Vercel and test tooling', () => {
  assert.equal(packageJson.engines?.node, '>=22.12.0 <23');
  assert.equal(typeof packageJson.scripts?.build, 'string');
  assert.match(packageJson.scripts.build, /no build step required/);

  assert.equal(vercelConfig.installCommand, 'pnpm install --frozen-lockfile');
  assert.equal(vercelConfig.buildCommand, 'pnpm run build');

  assert.doesNotMatch(vercelConfig.installCommand, /\bnpm install\b/);
  assert.doesNotMatch(vercelConfig.buildCommand, /\bnpm install\b/);
});
