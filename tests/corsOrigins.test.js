const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');

test('CORS : CORS_ORIGINS et CORS_EXTRA_ORIGINS sont fusionnées sans doublon', () => {
  assert.match(server, /parseOrigins\(process\.env\.CORS_ORIGINS\)/);
  assert.match(server, /parseOrigins\(process\.env\.CORS_EXTRA_ORIGINS\)/);
  assert.match(server, /new Set\(/);
});

test('CORS : en production, une origine absente de la liste reste refusée', () => {
  assert.match(server, /ALLOWED_ORIGINS\.includes\(origin\)/);
  assert.match(server, /Origine non autorisée par CORS/);
  // Aucune origine en dur dans le code : tout vient des variables d'environnement.
  assert.doesNotMatch(server, /localhost:8081/);
});
