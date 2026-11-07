const test = require('node:test');
const assert = require('node:assert/strict');
const { featureToPlace } = require('../utils/osmPlaces');
const { toApi } = require('../utils/placeSearch');

const pt = (props, id = 'n123') => ({
  id,
  properties: props,
  geometry: { type: 'Point', coordinates: [6.14, 46.2] },
});

test('un restaurant nommé devient un lieu', () => {
  const p = featureToPlace(pt({ amenity: 'restaurant', name: 'Chez Awa', cuisine: 'senegalese' }), 'europe/switzerland');
  assert.equal(p.kind, 'restaurant');
  assert.equal(p.isAfrican, true);
  assert.deepEqual(p.location.coordinates, [6.14, 46.2]);
  assert.equal(p.region, 'europe/switzerland');
});

test('sans nom ou hors catégorie => ignoré', () => {
  assert.equal(featureToPlace(pt({ amenity: 'restaurant' })), null);
  assert.equal(featureToPlace(pt({ amenity: 'bank', name: 'X' })), null);
});

test('épicerie et polygone (centre calculé)', () => {
  const f = {
    id: 'w9',
    properties: { shop: 'convenience', name: 'Épicerie Baobab' },
    geometry: { type: 'Polygon', coordinates: [[[6, 46], [6.2, 46], [6.2, 46.2], [6, 46.2], [6, 46]]] },
  };
  const p = featureToPlace(f);
  assert.equal(p.kind, 'grocery');
  assert.ok(p.location.coordinates[0] > 6 && p.location.coordinates[0] < 6.2);
});

test('format de réponse API', () => {
  const api = toApi({
    osmKey: 'node/1', kind: 'grocery', isAfrican: true, name: 'A',
    location: { coordinates: [6.1, 46.2] }, distanceMeters: 1234,
  });
  assert.equal(api.id, 'osm-node-1');
  assert.equal(api.category, 'african-grocery');
  assert.equal(api.distanceKm, 1.2);
  assert.equal(api.latitude, 46.2);
});
