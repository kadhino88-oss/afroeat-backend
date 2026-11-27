const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveEndpoints, DEFAULT_ENDPOINTS } = require('../utils/overpass');

test('serveurs Overpass : liste par défaut de plusieurs miroirs https, sans doublon', () => {
  assert.ok(DEFAULT_ENDPOINTS.length >= 5);
  assert.ok(DEFAULT_ENDPOINTS.every((u) => u.startsWith('https://')));
  assert.equal(new Set(DEFAULT_ENDPOINTS).size, DEFAULT_ENDPOINTS.length);
  assert.deepEqual(resolveEndpoints({}), DEFAULT_ENDPOINTS);
});

test('OVERPASS_ENDPOINTS remplace la liste ; http, identifiants et valeurs invalides sont ignorés', () => {
  const list = resolveEndpoints({
    OVERPASS_ENDPOINTS: 'https://a.example/api/interpreter, http://insecure.example/x, https://user:pw@b.example/x, pas une adresse, https://c.example/api/interpreter',
  });
  assert.deepEqual(list, ['https://a.example/api/interpreter', 'https://c.example/api/interpreter']);
  assert.deepEqual(resolveEndpoints({ OVERPASS_ENDPOINTS: 'rien de valide' }), DEFAULT_ENDPOINTS);
});

test('au plus 8 serveurs personnalisés', () => {
  const many = Array.from({ length: 12 }, (_, i) => `https://m${i}.example/api/interpreter`).join(',');
  assert.equal(resolveEndpoints({ OVERPASS_ENDPOINTS: many }).length, 8);
});
