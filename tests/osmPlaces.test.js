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

test('limite de résultats : défaut 1000, plafond 3000', () => {
  const { clampLimit } = require('../utils/placeSearch');
  assert.equal(clampLimit(undefined), 1000);
  assert.equal(clampLimit('abc'), 1000);
  assert.equal(clampLimit(250), 250);
  assert.equal(clampLimit(999999), 3000);
});

test('catégories attendues par l\'appli', () => {
  const base = { osmKey: 'node/2', name: 'X', location: { coordinates: [6, 46] }, distanceMeters: 100 };
  assert.equal(toApi({ ...base, kind: 'grocery', isAfrican: true }).category, 'african-grocery');
  assert.equal(toApi({ ...base, kind: 'fast_food', isAfrican: true }).category, 'african-fast-food');
  assert.equal(toApi({ ...base, kind: 'fast_food', isAfrican: false }).category, 'restaurant');
  assert.equal(toApi({ ...base, kind: 'restaurant' }).category, 'restaurant');
});

test('boutiques exotiques repérées comme africaines', () => {
  const p = featureToPlace({ id: 'n5', properties: { shop: 'convenience', name: 'Exotic Food Market' }, geometry: { type: 'Point', coordinates: [6, 46] } });
  assert.equal(p.isAfrican, true);
});

test('le workflow d\'import accepte plusieurs régions et protège la base', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const wf = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'import-osm-places.yml'), 'utf8');
  const script = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'import-osm-places.js'), 'utf8');
  assert.match(wf, /regions:/);
  assert.match(wf, /african_only:/);
  assert.match(wf, /for REGION in \$LIST/);
  assert.match(script, /MAX_DB_MB/);
  assert.match(script, /AFRICAN_ONLY && !doc\.isAfrican/);
});

test('détection africaine : bons positifs, pas de faux positifs courants', () => {
  const { AFRICAN_RE } = require('../utils/osmPlaces');
  for (const t of ['Chez Awa sénégalais', 'Exotic Food Market', 'Afro Market', 'Mafé Express', "Cuisines d'Afrique", 'Gambia Corner']) {
    assert.ok(AFRICAN_RE.test(t), t);
  }
  for (const t of ['Pizzeria Gambini', 'Trattoria Maurizio', 'Afrodite Taverna', "McDonald's", 'Coop Pronto']) {
    assert.ok(!AFRICAN_RE.test(t), t);
  }
});

test('AFROEAT ne référence que des commerces africains par défaut', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const controller = fs.readFileSync(path.join(__dirname, '..', 'controllers', 'placeController.js'), 'utf8');
  const script = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'import-osm-places.js'), 'utf8');
  const wf = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'import-osm-places.yml'), 'utf8');
  assert.match(controller, /const africanOnly = req\.query\.all !== '1'/);
  assert.match(script, /AFRICAN_ONLY \|\| 'true'/);
  assert.match(wf, /default: true/);
});
