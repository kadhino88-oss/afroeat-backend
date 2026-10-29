'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const ignored = new Set(['node_modules', '.git', '.expo', 'coverage', 'dist', 'build']);
const files = [];

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory() && ignored.has(entry.name)) continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(fullPath);
    else if (entry.isFile() && fullPath.endsWith('.js')) files.push(fullPath);
  }
}

walk(root);
let failures = 0;
for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (result.status !== 0) {
    failures += 1;
    console.error(`\n[SYNTAX ERROR] ${path.relative(root, file)}`);
    if (result.stderr) console.error(result.stderr.trim());
  }
}

if (failures) {
  console.error(`\n${failures}/${files.length} JavaScript file(s) failed syntax checks.`);
  process.exitCode = 1;
} else {
  console.log(`Syntax check passed: ${files.length} JavaScript file(s) checked.`);
}
