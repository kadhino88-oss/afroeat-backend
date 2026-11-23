'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const Restaurant = require('../models/Restaurant');
const MenuItem = require('../models/MenuItem');
const Order = require('../models/Order');
const ctrl = require('../controllers/restaurantController');

const res = () => ({ statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } });
const chain = (result) => {
  const q = { populate: () => q, sort: () => q, skip: () => q, limit: () => q, lean: () => q, select: () => q, then: (ok, ko) => Promise.resolve(result).then(ok, ko) };
  return q;
};

const ID = '64b000000000000000000001';
const rawRestaurant = (extra = {}) => ({
  _id: ID, name: 'Chez Awa', cuisine: 'Africaine', address: '1 rue X', city: 'Paris', country: 'France',
  latitude: 48.85, longitude: 2.35, isActive: true, isOpen: true, deliveryFee: 2, currency: 'EUR',
  owner: { _id: 'o1', name: 'Awa', email: 'owner@secret.test', phone: '+33600000000', role: 'restaurant', accountStatus: 'approved', isIdentityVerified: true },
  revenue: 9999, totalOrders: 42, stats: { revenue: 9999 }, autoAcceptOrders: true, email: 'private@secret.test',
  ...extra,
});

const assertNoLeak = (restaurant) => {
  const json = JSON.stringify(restaurant);
  for (const forbidden of ['owner@secret.test', '+33600000000', 'private@secret.test', 'accountStatus', 'isIdentityVerified']) {
    assert.ok(!json.includes(forbidden), `fuite: ${forbidden}`);
  }
  for (const key of ['owner', 'revenue', 'totalOrders', 'pendingOrders', 'deliveredOrders', 'cancelledOrders', 'stats', 'autoAcceptOrders', 'email']) {
    assert.equal(key in restaurant, false, `champ interdit: ${key}`);
  }
  assert.equal(restaurant.name, 'Chez Awa');
};

test('GET /restaurants : projection publique, isActive forcé, aucune requête de stats', async () => {
  let seenFilters; let orderQueried = false;
  Restaurant.countDocuments = async (f) => { seenFilters = f; return 1; };
  Restaurant.find = (f) => { seenFilters = f; return chain([rawRestaurant()]); };
  MenuItem.find = () => chain([{ _id: 'm1', restaurant: ID, name: 'Mafé', price: 10, category: 'Plats', createdAt: 'x' }]);
  Order.find = () => { orderQueried = true; return chain([]); };

  const r = res();
  await ctrl.getRestaurants({ query: { isActive: 'false', ownerId: 'o1' } }, r);
  assert.equal(r.statusCode, 200);
  assert.equal(seenFilters.isActive, true);
  assert.equal('owner' in seenFilters, false);
  assert.equal(orderQueried, false);
  assertNoLeak(r.body.restaurants[0]);
  assert.equal(r.body.restaurants[0].menu[0].name, 'Mafé');
  assert.deepEqual(r.body.restaurants[0].categories, ['Plats']);
});

test('GET /restaurants/nearby : projection publique et distance', async () => {
  Restaurant.find = (f) => { assert.equal(f.isActive, true); return chain([rawRestaurant()]); };
  MenuItem.find = () => chain([]);
  const r = res();
  await ctrl.getNearbyRestaurants({ query: { lat: '48.85', lng: '2.35' } }, r);
  assert.equal(r.statusCode, 200);
  assert.equal(r.body.restaurants.length, 1);
  assert.equal(typeof r.body.restaurants[0].distanceKm, 'number');
  assertNoLeak(r.body.restaurants[0]);
});

test('GET /restaurants/:id : projection publique ; restaurant désactivé = 404', async () => {
  MenuItem.find = () => chain([]);
  Restaurant.findById = () => chain(rawRestaurant());
  const ok = res();
  await ctrl.getRestaurantById({ params: { id: ID } }, ok);
  assert.equal(ok.statusCode, 200);
  assertNoLeak(ok.body.restaurant);

  Restaurant.findById = () => chain(rawRestaurant({ isActive: false }));
  const off = res();
  await ctrl.getRestaurantById({ params: { id: ID } }, off);
  assert.equal(off.statusCode, 404);
});
