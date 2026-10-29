'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const SKIP_DIRS = new Set(['.git', 'node_modules', 'coverage', 'dist', 'build']);

const collectJavaScript = (directory) => {
  const results = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) {
        results.push(...collectJavaScript(path.join(directory, entry.name)));
      }
      continue;
    }
    if (entry.isFile() && /\.(?:cjs|mjs|js)$/.test(entry.name)) {
      results.push(path.join(directory, entry.name));
    }
  }
  return results;
};

const files = collectJavaScript(ROOT);
let failures = 0;
for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (result.status !== 0) {
    failures += 1;
    process.stderr.write(`\nSyntax error: ${path.relative(ROOT, file)}\n`);
    process.stderr.write(result.stderr || result.stdout || '');
  }
}

if (failures) {
  process.stderr.write(`\n${failures} of ${files.length} JavaScript files failed syntax checks.\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(`Syntax check passed for ${files.length} JavaScript files.\n`);
}
