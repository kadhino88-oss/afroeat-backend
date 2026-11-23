#!/usr/bin/env node
// PostToolUse (Edit|Write|MultiEdit): vérifie la syntaxe JS du fichier modifié.
const { spawnSync } = require('node:child_process');
let raw = '';
process.stdin.on('data', (c) => (raw += c));
process.stdin.on('end', () => {
  let file;
  try { file = JSON.parse(raw)?.tool_input?.file_path; } catch { process.exit(0); }
  if (!file || !/\.(cjs|mjs|js)$/.test(file) || file.includes('node_modules')) process.exit(0);
  const r = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (r.status !== 0) {
    process.stderr.write(`Erreur de syntaxe dans ${file}:\n${r.stderr}`);
    process.exit(2);
  }
});
