const test = require('node:test');
const assert = require('node:assert/strict');
const { checkDeliveryZone, radiusKmFor, _clearCache } = require('../utils/deliveryZone');

const annemasse = { latitude: 46.1937, longitude: 6.2354, country: 'France', deliveryRadiusKm: 5 };

test('adresse dans le rayon : acceptée avec la distance', async () => {
  _clearCache();
  const r = await checkDeliveryZone({ restaurant: annemasse, address: '1 rue Proche, Annemasse', geocode: async () => ({ lat: 46.2, lng: 6.24 }) });
  assert.equal(r.ok, true);
  assert.equal(r.checked, true);
  assert.ok(r.distanceKm < 5);
});

test('adresse hors rayon : refusée', async () => {
  _clearCache();
  const r = await checkDeliveryZone({ restaurant: annemasse, address: '5 rue Lointaine, Annecy', geocode: async () => ({ lat: 45.8992, lng: 6.1294 }) });
  assert.equal(r.ok, false);
  assert.equal(r.radiusKm, 5);
  assert.ok(r.distanceKm > 30);
});

test('géocodage en échec ou erreur : la commande n’est pas bloquée', async () => {
  _clearCache();
  const none = await checkDeliveryZone({ restaurant: annemasse, address: 'Adresse introuvable 123', geocode: async () => null });
  assert.deepEqual([none.ok, none.checked], [true, false]);
  const boom = await checkDeliveryZone({ restaurant: annemasse, address: 'Adresse en panne 456', geocode: async () => { throw new Error('réseau'); } });
  assert.deepEqual([boom.ok, boom.checked], [true, false]);
});

test('commerce sans position : pas de contrôle ; rayon par défaut et bornes', async () => {
  _clearCache();
  const r = await checkDeliveryZone({ restaurant: { country: 'France' }, address: '1 rue X, Y', geocode: async () => { throw new Error('ne doit pas être appelé'); } });
  assert.equal(r.checked, false);
  assert.equal(radiusKmFor({}), 10);
  assert.equal(radiusKmFor({ deliveryRadiusKm: 0 }), 10);
  assert.equal(radiusKmFor({ deliveryRadiusKm: 3 }), 3);
  assert.equal(radiusKmFor({ deliveryRadiusKm: 500 }), 10);
});

test('la même adresse n’est géocodée qu’une fois', async () => {
  _clearCache();
  let calls = 0;
  const geocode = async () => { calls += 1; return { lat: 46.2, lng: 6.24 }; };
  await checkDeliveryZone({ restaurant: annemasse, address: 'Rue du Cache 1', geocode });
  await checkDeliveryZone({ restaurant: annemasse, address: 'rue du cache 1', geocode });
  assert.equal(calls, 1);
});
