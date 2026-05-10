#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import process from 'node:process';

const vercelEnv = (process.env.VERCEL_ENV || 'local').trim();
const dbUrl = (process.env.SUPABASE_DB_URL || '').trim();
const enableOnBuild = String(process.env.SUPABASE_PUSH_ON_BUILD || '').trim().toLowerCase() === 'true';

console.log(`[Supabase Deploy] build env: ${vercelEnv}`);

if (!dbUrl) {
  const skipMessage = '[Supabase Deploy] SUPABASE_DB_URL is not set. Skipping migration push.';

  if (vercelEnv === 'production' || enableOnBuild) {
    console.error(`${skipMessage} Set SUPABASE_DB_URL in Vercel project environment variables.`);
    process.exit(1);
  }

  console.log(skipMessage);
  process.exit(0);
}

console.log('[Supabase Deploy] Applying pending migrations with supabase db push...');

try {
  execFileSync('npx', ['supabase', 'db', 'push', '--db-url', dbUrl], {
    stdio: 'inherit',
    env: {
      ...process.env,
      CI: 'true',
    },
  });
  console.log('[Supabase Deploy] Migrations applied successfully.');
} catch (error) {
  console.error('[Supabase Deploy] Migration push failed.');
  process.exit(error?.status ?? 1);
}
