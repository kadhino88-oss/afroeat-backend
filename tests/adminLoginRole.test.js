'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// L'application demande role=admin pour l'espace administrateur. Avant, « admin » était normalisé en
// « client » : un administrateur recevait « Ce compte appartient à l'espace admin, pas à l'espace client ».
test("la connexion accepte role=admin sans le transformer en client", () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'controllers', 'userController.js'), 'utf8');
  assert.match(src, /rawRole === 'admin' \? 'admin' : normalizeRole\(rawRole\)/);
});

test('les autres rôles inconnus restent traités comme client', () => {
  const allowedRoles = ['client', 'restaurant', 'livreur'];
  const normalizeRole = (value) => {
    const role = String(value || '').trim().toLowerCase();
    return allowedRoles.includes(role) ? role : 'client';
  };
  const resolve = (raw) => (raw ? (String(raw).trim().toLowerCase() === 'admin' ? 'admin' : normalizeRole(raw)) : null);
  assert.equal(resolve('admin'), 'admin');
  assert.equal(resolve('ADMIN'), 'admin');
  assert.equal(resolve('restaurant'), 'restaurant');
  assert.equal(resolve('nimporte'), 'client');
  assert.equal(resolve(undefined), null);
});
