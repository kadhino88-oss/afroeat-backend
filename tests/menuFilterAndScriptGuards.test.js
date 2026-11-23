'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { escapeRegex } = require('../utils/escapeRegex');
const menuRoutes = require('../routes/menuRoutes');

test('escapeRegex neutralise les métacaractères', () => {
  assert.equal(escapeRegex('a.*(b)+'), 'a\\.\\*\\(b\\)\\+');
  const re = new RegExp(escapeRegex('.*'), 'i');
  assert.equal(re.test('Plats'), false);
  assert.equal(re.test('a.*b'), true);
});

test('le filtre de menu échappe category et cuisine (pas de ReDoS / injection regex)', () => {
  const filter = menuRoutes.buildMenuFilterFromQuery({ category: '(a+)+$', cuisine: '.*' });
  assert.equal(filter.category.$regex, '\\(a\\+\\)\\+\\$');
  assert.equal(filter.cuisine.$regex, '\\.\\*');
  assert.equal(new RegExp(filter.cuisine.$regex, 'i').test('Africaine'), false);
  assert.equal(new RegExp(filter.category.$regex, 'i').test('Plats'), false);
  const plain = menuRoutes.buildMenuFilterFromQuery({ category: 'plats' });
  assert.equal(new RegExp(plain.category.$regex, plain.category.$options).test('Plats du jour'), true);
});

test('promote-admin applique la même garde de base que set-restaurant-active', () => {
  const promote = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'promote-admin.js'), 'utf8');
  const active = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'set-restaurant-active.js'), 'utf8');
  const decl = "const EXPECTED_DB = process.env.EXPECT_DB || 'afroeat_staging';";
  assert.ok(active.includes(decl));
  assert.ok(promote.includes(decl));
  // La garde s'exécute avant toute lecture/modification du compte.
  assert.ok(promote.indexOf('mongoose.connection.name !== EXPECTED_DB') < promote.indexOf('User.findById'));
});
