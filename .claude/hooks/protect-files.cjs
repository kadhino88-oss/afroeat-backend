#!/usr/bin/env node
// PreToolUse (Edit|Write|MultiEdit): bloque les fichiers secrets/lockfiles, demande confirmation pour la config de déploiement.
const path = require('node:path');
let raw = '';
process.stdin.on('data', (c) => (raw += c));
process.stdin.on('end', () => {
  let input = {};
  try { input = JSON.parse(raw); } catch { process.exit(0); }
  const file = input?.tool_input?.file_path;
  if (!file) process.exit(0);
  const base = path.basename(file);

  const isEnv = /^\.env(\..+)?$/.test(base) && base !== '.env.example';
  const isLock = base === 'package-lock.json';
  const isSecret = /\.(pem|key|jks|p8|p12|mobileprovision)$/i.test(base);
  if (isEnv || isLock || isSecret) {
    process.stderr.write(
      `Bloqué: ${base} est protégé (secrets / lockfile). Modifiez-le manuellement (npm install pour le lockfile, .env.example pour documenter une variable).\n`
    );
    process.exit(2);
  }

  const sensitive = ['eas.json', 'vercel.json', 'app.config.js', 'configdb.js'];
  const inWorkflows = file.includes(`${path.sep}.github${path.sep}workflows${path.sep}`);
  if (sensitive.includes(base) || inWorkflows) {
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'ask',
        permissionDecisionReason: `${base} pilote le déploiement/la prod: confirmation requise.`,
      },
    }));
  }
  process.exit(0);
});
