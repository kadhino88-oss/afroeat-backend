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
  assert.match(server, /isOriginAllowed\(origin, ALLOWED_ORIGINS\)/);
  assert.match(server, /Origine non autorisée par CORS/);
  // Aucune origine en dur dans le code : tout vient des variables d'environnement.
  assert.doesNotMatch(server, /localhost:8081/);
});

const { isOriginAllowed } = require('../utils/corsOrigins');

test('CORS : un joker ne remplace que des caractères de nom d\'hôte (aperçus Vercel de l\'équipe)', () => {
  const list = ['https://afroeat-app-*-bk-entreprise.vercel.app', 'https://site.example'];
  assert.equal(isOriginAllowed('https://afroeat-app-git-feat-x-bk-entreprise.vercel.app', list), true);
  assert.equal(isOriginAllowed('https://afroeat-app-9xhz-bk-entreprise.vercel.app', list), true);
  assert.equal(isOriginAllowed('https://site.example', list), true);
  // Pas de sous-domaines imbriqués, ni de domaine déguisé, ni de protocole différent.
  assert.equal(isOriginAllowed('https://afroeat-app-x.evil.com/-bk-entreprise.vercel.app', list), false);
  assert.equal(isOriginAllowed('https://afroeat-app-a.b-bk-entreprise.vercel.app', list), false);
  assert.equal(isOriginAllowed('https://afroeat-app-x-bk-entreprise.vercel.app.evil.com', list), false);
  assert.equal(isOriginAllowed('http://afroeat-app-x-bk-entreprise.vercel.app', list), false);
  assert.equal(isOriginAllowed('https://evil.example', list), false);
  assert.equal(isOriginAllowed('', list), false);
});
