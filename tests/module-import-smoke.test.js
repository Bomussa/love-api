import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir } from 'node:fs/promises';
import path from 'node:path';

const projectRoot = path.resolve(process.cwd());

const CRITICAL_MODULES = [
  'lib/supabase-client.js',
  'lib/supabase.js',
];

async function getApiModules() {
  const apiDir = path.join(projectRoot, 'api');
  const entries = await readdir(apiDir, { withFileTypes: true });

  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.js'))
    .map((entry) => path.join('api', entry.name));
}

test('critical runtime modules are importable', async () => {
  process.env.SUPABASE_URL ??= 'https://example.supabase.co';
  process.env.SUPABASE_ANON_KEY ??= 'anon-test-key';
  process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'service-role-test-key';
  const apiModules = await getApiModules();
  const targets = [...CRITICAL_MODULES, ...apiModules];

  for (const modulePath of targets) {
    const fileUrl = new URL(modulePath, `file://${projectRoot}/`);
    await assert.doesNotReject(() => import(fileUrl.href), `Failed importing ${modulePath}`);
  }
});
