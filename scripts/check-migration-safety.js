#!/usr/bin/env node

import { execSync } from 'node:child_process';
import fs from 'node:fs';

const MIGRATIONS_DIR = 'supabase/migrations/';

function run(cmd) {
  return execSync(cmd, { encoding: 'utf8' }).trim();
}

function getChangedMigrations(base, head) {
  const output = run(`git diff --name-status ${base} ${head}`);
  if (!output) return [];

  const files = [];
  for (const line of output.split('\n')) {
    const [status, oldPath, newPath] = line.split('\t');
    const path = status.startsWith('R') ? newPath : oldPath;
    if (!path?.startsWith(MIGRATIONS_DIR) || !path.endsWith('.sql')) continue;
    if (status === 'A' || status === 'M' || status.startsWith('R')) files.push(path);
  }
  return files;
}

function main() {
  const base = process.argv[2];
  const head = process.argv[3] || 'HEAD';
  if (!base) {
    console.error('Usage: node scripts/check-migration-safety.js <base_sha> [head_sha]');
    process.exit(2);
  }

  const files = getChangedMigrations(base, head);
  if (files.length === 0) {
    console.log('No changed migrations under supabase/migrations; safety check skipped.');
    return;
  }

  const errors = [];
  const createPattern = /create\s+(table|index|view|materialized\s+view|function|policy)\s+(?!if\s+not\s+exists)/gi;

  for (const file of files) {
    const sql = fs.readFileSync(file, 'utf8');
    const hasTransformPlan = /--\s*transform-plan\s*:/i.test(sql);
    const hits = [...sql.matchAll(createPattern)];

    if (hits.length > 0 && !hasTransformPlan) {
      errors.push(
        `${file}: contains CREATE statements without IF NOT EXISTS and missing '-- transform-plan:' annotation.`
      );
    }
  }

  if (errors.length > 0) {
    console.error('Migration safety check failed:\n');
    console.error(errors.join('\n'));
    process.exit(1);
  }

  console.log('Migration safety check passed.');
}

main();
