const test = require('node:test');
const assert = require('node:assert/strict');
const { clampRadiusKm, distanceKm, MAX_RADIUS_KM } = require('../utils/overpass');

test('le rayon n\'est plus plafonné à 30 km', () => {
  assert.equal(clampRadiusKm(50), 50);
  assert.equal(clampRadiusKm(30), 30);
});

test('rayon invalide => défaut, rayon énorme => plafond technique', () => {
  assert.equal(clampRadiusKm('abc'), 10);
  assert.equal(clampRadiusKm(-3), 10);
  assert.equal(clampRadiusKm(5000), MAX_RADIUS_KM);
});

test('distance Genève - Lausanne ≈ 52 km', () => {
  const d = distanceKm(46.2044, 6.1432, 46.5197, 6.6323);
  assert.ok(d > 48 && d < 56, String(d));
});
