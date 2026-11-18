const test = require('node:test');
const assert = require('node:assert/strict');
const {
  distanceKm,
  isWithinDispatchRadius,
  courierPoint,
  restaurantPoint,
  availableOrderFilter,
} = require('../utils/courierDispatch');

test('distance Annemasse → Genève centre ≈ 8 km', () => {
  const d = distanceKm({ lat: 46.1934, lng: 6.2342 }, { lat: 46.2044, lng: 6.1432 });
  assert.ok(d > 6 && d < 9, `distance ${d}`);
  assert.equal(distanceKm(null, { lat: 1, lng: 1 }), null);
});

test('une course proche est proposée, une lointaine non ; sans position on propose', () => {
  const resto = { lat: 46.1934, lng: 6.2342 };
  assert.equal(isWithinDispatchRadius({ lat: 46.19, lng: 6.24 }, resto, 8), true);
  assert.equal(isWithinDispatchRadius({ lat: 45.76, lng: 4.83 }, resto, 8), false); // Lyon
  assert.equal(isWithinDispatchRadius(null, resto, 8), true);
});

test('la position d’un livreur expire après 30 minutes', () => {
  const now = Date.now();
  const fresh = { deliveryProfile: { currentLat: 46.2, currentLng: 6.1, lastLocationUpdateAt: new Date(now - 5 * 60000) } };
  const stale = { deliveryProfile: { currentLat: 46.2, currentLng: 6.1, lastLocationUpdateAt: new Date(now - 45 * 60000) } };
  assert.deepEqual(courierPoint(fresh, now), { lat: 46.2, lng: 6.1 });
  assert.equal(courierPoint(stale, now), null);
});

test('position du restaurant : commande puis fiche restaurant', () => {
  assert.deepEqual(restaurantPoint({ restaurantLocation: { lat: 46.1, lng: 6.2 } }), { lat: 46.1, lng: 6.2 });
  assert.deepEqual(
    restaurantPoint({ restaurantLocation: { lat: null, lng: null }, restaurant: { location: { latitude: 46.3, longitude: 6.4 } } }),
    { lat: 46.3, lng: 6.4 }
  );
  assert.equal(restaurantPoint({ restaurant: {} }), null);
});

test('seules les commandes payées, livrées par AFROEAT et sans livreur sont disponibles', () => {
  const f = availableOrderFilter();
  // Payées en ligne, ou à encaisser en espèces par le livreur (jamais les commandes carte non payées).
  assert.deepEqual(f.$and[0].$or[0], { paymentStatus: 'Payé' });
  assert.equal(f.$and[0].$or[1].paymentMethod, 'cash');
  assert.deepEqual(f.selfDelivery, { $ne: true });
  assert.deepEqual(f.status.$in, ['Confirmée', 'En préparation']);
});
