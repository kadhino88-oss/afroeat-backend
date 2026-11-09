'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
const { isAccountAllowedToAccessProtectedRoutes } = require('../middleware/authMiddleware');

test('client en attente de vérification : accès autorisé (plus de « Compte non actif »)', () => {
  assert.equal(isAccountAllowedToAccessProtectedRoutes({ role: 'client', accountStatus: 'pending_verification' }), true);
});

test('client suspendu ou rejeté : toujours bloqué', () => {
  for (const accountStatus of ['suspended', 'rejected']) {
    assert.equal(isAccountAllowedToAccessProtectedRoutes({ role: 'client', accountStatus }), false, accountStatus);
  }
});

test('restaurant et livreur en attente de validation : toujours bloqués', () => {
  for (const role of ['restaurant', 'livreur']) {
    assert.equal(isAccountAllowedToAccessProtectedRoutes({ role, accountStatus: 'pending_verification' }), false, role);
  }
});

test("inscription : un client est créé actif, un partenaire en attente de validation", () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'controllers', 'userController.js'), 'utf8');
  assert.match(src, /accountStatus: payload\.role === 'client' \? 'active' : 'pending_verification'/);
});
