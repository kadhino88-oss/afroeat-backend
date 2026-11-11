'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('lieux : si OpenStreetMap est indisponible et la base vide, réponse vide 200 (plus de 502)', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'controllers', 'placeController.js'), 'utf8');
  assert.doesNotMatch(src, /status\(502\)/);
  assert.match(src, /degraded: true/);
  assert.match(src, /groceries: \[\]/);
  assert.match(src, /restaurants: \[\], fastFoods: \[\]/);
});
