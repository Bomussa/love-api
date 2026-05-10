import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';

const ROOTS = ['lib', 'api'];
const ALLOWED_EXTENSIONS = new Set(['.js', '.ts']);
const MIXED_MODULE_PATTERNS = [
  /\brequire\s*\(/,
  /\bmodule\.exports\b/,
  /\bexports\.[A-Za-z_$]/,
];

async function* walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      yield* walk(fullPath);
      continue;
    }

    yield fullPath;
  }
}

async function main() {
  const violations = [];

  for (const root of ROOTS) {
    for await (const filePath of walk(root)) {
      const ext = path.extname(filePath);
      if (!ALLOWED_EXTENSIONS.has(ext)) continue;

      const fileStat = await stat(filePath);
      if (!fileStat.isFile()) continue;

      const content = await readFile(filePath, 'utf8');
      const matched = MIXED_MODULE_PATTERNS.filter((pattern) => pattern.test(content));

      if (matched.length > 0) {
        violations.push(filePath);
      }
    }
  }

  if (violations.length > 0) {
    console.error('Module-style check failed. CommonJS patterns detected in shared runtime code:');
    for (const file of violations) {
      console.error(` - ${file}`);
    }
    process.exit(1);
  }

  console.log('Module-style check passed. No CommonJS patterns found in lib/ or api/.');
}

await main();
