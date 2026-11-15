'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { isAdminOriginAllowed, requireAdminOrigin } = require('../utils/adminOrigin');

const ENV = { ADMIN_WEB_ORIGINS: 'https://afroeat-admin.vercel.app/' };

test('sans configuration, rien n’est restreint (test et développement)', () => {
  assert.equal(isAdminOriginAllowed('https://nimporte.test', {}), true);
  assert.equal(isAdminOriginAllowed(undefined, {}), true);
});

test('avec la configuration, seule l’adresse d’administration est acceptée', () => {
  assert.equal(isAdminOriginAllowed('https://afroeat-admin.vercel.app', ENV), true);
  assert.equal(isAdminOriginAllowed('https://afroeat-app.vercel.app', ENV), false);
  assert.equal(isAdminOriginAllowed('https://afroeat-admin.vercel.app.evil.test', ENV), false);
  assert.equal(isAdminOriginAllowed('', ENV), false);
  assert.equal(isAdminOriginAllowed(undefined, ENV), false);
});

test('le garde-fou des routes refuse une autre origine avec un 403', () => {
  const previous = process.env.ADMIN_WEB_ORIGINS;
  process.env.ADMIN_WEB_ORIGINS = ENV.ADMIN_WEB_ORIGINS;
  try {
    let status = 0;
    let passed = false;
    const res = { status(code) { status = code; return this; }, json() { return this; } };
    requireAdminOrigin({ headers: { origin: 'https://afroeat-app.vercel.app' } }, res, () => { passed = true; });
    assert.equal(status, 403);
    assert.equal(passed, false);
    requireAdminOrigin({ headers: { origin: 'https://afroeat-admin.vercel.app' } }, res, () => { passed = true; });
    assert.equal(passed, true);
  } finally {
    if (previous === undefined) delete process.env.ADMIN_WEB_ORIGINS;
    else process.env.ADMIN_WEB_ORIGINS = previous;
  }
});

test('le verrou est branché sur l’API admin et sur la connexion', () => {
  const routes = fs.readFileSync(path.join(__dirname, '..', 'routes', 'adminRoutes.js'), 'utf8');
  assert.match(routes, /router\.use\(requireAdmin\);[\s\S]{0,160}router\.use\(requireAdminOrigin\);/);
  const login = fs.readFileSync(path.join(__dirname, '..', 'controllers', 'userController.js'), 'utf8');
  assert.match(login, /user\.role === 'admin' && !isAdminOriginAllowed\(req\.headers\?\.origin\)/);
});
